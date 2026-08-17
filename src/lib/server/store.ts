import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getRuntimeConfig, type InlineReferenceImage } from "@/lib/ai/image-generation";
import { IMAGE_AGENT_PROMPTS } from "@/lib/agent/prompt-config";
import { listSkillManifestsSync } from "@/lib/agent/skill-registry";
import { createSeedStore } from "@/lib/mock-data";
import {
  buildAssetSemanticSummary,
  buildFallbackAssetSemanticSummary,
} from "@/lib/server/context-memory";
import { buildConversationContextSnapshot } from "@/lib/server/conversation-context";
import { detectImageDimensions } from "@/lib/server/image-dimensions";
import type {
  AppStore,
  ConversationMessage,
  CurrentSessionView,
  GeneratedHistoryItem,
  ImageAsset,
  PersistedConversation,
  SessionSummary,
  WorkspaceState,
} from "@/lib/types";

const STORE_VERSION = 1;
const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const PUBLIC_MEDIA_DIR = path.join(process.cwd(), "public", "media");
const APP_TIME_ZONE = "Asia/Shanghai";

const clockFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: APP_TIME_ZONE,
});

let writeQueue = Promise.resolve();

const nowIso = () => new Date().toISOString();

const byNewestConversation = (a: PersistedConversation, b: PersistedConversation) =>
  new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

const truncate = (text: string, max = 52) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

const formatClock = (iso: string) => clockFormatter.format(new Date(iso));

const formatRelativeTime = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < 5 * minute) {
    return "刚刚";
  }

  if (diffMs < hour) {
    return `${Math.max(1, Math.round(diffMs / minute))} 分钟前`;
  }

  if (diffMs < day) {
    return `${Math.max(1, Math.round(diffMs / hour))} 小时前`;
  }

  return `${Math.max(1, Math.round(diffMs / day))} 天前`;
};

const mimeTypeToExtension = (mimeType: string) => {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default:
      return "bin";
  }
};

const inferDefaultDimensions = (mimeType: string) => {
  if (mimeType === "image/svg+xml") {
    return { width: 900, height: 520 };
  }

  return { width: 1024, height: 1024 };
};

const parseDataUrl = (input: string): InlineReferenceImage | null => {
  const match = /^data:([^;,]+)(;charset=[^;,]+)?(;base64)?,([\s\S]*)$/.exec(input);

  if (!match) {
    return null;
  }

  const [, mimeType, , base64Flag, payload] = match;

  return {
    mimeType,
    base64Data: base64Flag
      ? payload
      : Buffer.from(decodeURIComponent(payload), "utf8").toString("base64"),
  };
};

const getAssetFilePath = (asset: ImageAsset) =>
  path.join(process.cwd(), "public", asset.url.replace(/^\//, ""));

const resolveImageDimensions = async (asset: ImageAsset) => {
  const inlineFromDataUrl = parseDataUrl(asset.url);
  const buffer = inlineFromDataUrl
    ? Buffer.from(inlineFromDataUrl.base64Data, "base64")
    : await fs.readFile(getAssetFilePath(asset));
  return detectImageDimensions(buffer, asset.mimeType);
};

async function normalizeStoreAssets(store: AppStore) {
  let changed = false;

  for (const conversation of store.conversations) {
    for (const asset of conversation.assets) {
      if (!asset.semanticSummary) {
        asset.semanticSummary = asset.observations
          ? buildAssetSemanticSummary(asset, asset.observations)
          : buildFallbackAssetSemanticSummary(asset);
        changed = true;
      }
      try {
        const detected = await resolveImageDimensions(asset);

        if (
          detected &&
          (asset.width !== detected.width || asset.height !== detected.height)
        ) {
          asset.width = detected.width;
          asset.height = detected.height;
          changed = true;
        }
      } catch {
        continue;
      }
    }
  }

  return changed;
}

async function ensureStorageInitialized() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(PUBLIC_MEDIA_DIR, { recursive: true });

  try {
    await fs.access(STORE_FILE);
  } catch {
    await writeStoreRaw(createSeedStore());
  }
}

async function readStoreRaw(): Promise<AppStore> {
  await ensureStorageInitialized();
  const raw = await fs.readFile(STORE_FILE, "utf8");
  const parsed = JSON.parse(raw) as AppStore;

  if (parsed.version !== STORE_VERSION) {
    const reset = createSeedStore();
    await writeStoreRaw(reset);
    return reset;
  }

  if (parsed.conversations.length === 0) {
    parsed.conversations.push(createEmptyConversation());
    await writeStoreRaw(parsed);
  }

  if (await normalizeStoreAssets(parsed)) {
    await writeStoreRaw(parsed);
  }

  return parsed;
}

async function writeStoreRaw(store: AppStore) {
  const tempFile = `${STORE_FILE}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tempFile, STORE_FILE);
}

async function queueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const pending = writeQueue.then(operation, operation);
  writeQueue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

export async function mutateStore<T>(mutator: (store: AppStore) => Promise<T> | T): Promise<T> {
  return queueWrite(async () => {
    const store = await readStoreRaw();
    const result = await mutator(store);
    await writeStoreRaw(store);
    return result;
  });
}

export async function readStore() {
  return readStoreRaw();
}

const assetMapForConversation = (conversation: PersistedConversation) =>
  new Map(conversation.assets.map((asset) => [asset.id, asset]));

const toConversationMessageView = (
  message: PersistedConversation["messages"][number],
  assets: Map<string, ImageAsset>,
): ConversationMessage => ({
  id: message.id,
  role: message.role,
  text: message.text,
  reasoning: message.reasoning,
  createdAt: formatClock(message.createdAt),
  mode: message.mode,
  userNote: message.userNote,
  debugTrace: message.debugTrace,
  generationForm: message.generationForm,
  aPlusBriefForm: message.aPlusBriefForm,
  attachments: message.attachmentIds.map((id) => assets.get(id)).filter(Boolean) as ImageAsset[],
});

const buildHistoryView = (conversation: PersistedConversation): GeneratedHistoryItem[] =>
  conversation.assets
    .filter((asset) => asset.kind === "generated")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((asset, index) => {
      const sourceMessage = conversation.messages.find((message) => message.id === asset.sourceMessageId);
      const parentAsset = asset.derivedFromAssetId
        ? conversation.assets.find((entry) => entry.id === asset.derivedFromAssetId)
        : undefined;
      return {
        id: `history_${asset.id}`,
        index: index + 1,
        title: asset.label,
        note: truncate(
          asset.focus || sourceMessage?.text || IMAGE_AGENT_PROMPTS.workspaceText.defaultHistoryNote,
          84,
        ),
        createdAt: formatClock(asset.createdAt),
        sourceMessageId: asset.sourceMessageId ?? "",
        sourceLabel: sourceMessage?.text ? truncate(sourceMessage.text, 48) : undefined,
        derivedFromTitle: parentAsset?.label,
        asset,
      };
    });

const buildSessionSummary = (
  conversation: PersistedConversation,
  activeConversationId: string,
): SessionSummary => {
  const context = buildConversationContextSnapshot(conversation);
  const lastUserMessage = [...conversation.messages]
    .reverse()
    .find((message) => message.role === "user");

  return {
    id: conversation.id,
    title: context.title,
    lastUserIntent: truncate(
      lastUserMessage?.text ?? IMAGE_AGENT_PROMPTS.workspaceText.emptySessionIntent,
    ),
    updatedAt: formatRelativeTime(conversation.updatedAt),
    isActive: conversation.id === activeConversationId,
  };
};

const buildCurrentSession = (conversation: PersistedConversation): CurrentSessionView => {
  const context = buildConversationContextSnapshot(conversation);
  const assets = assetMapForConversation(conversation);
  const history = buildHistoryView(conversation);
  const referenceIds = new Set<string>();

  for (const message of conversation.messages.slice(-4)) {
    for (const assetId of message.attachmentIds) {
      referenceIds.add(assetId);
    }
  }

  return {
    id: conversation.id,
    title: context.title,
    subtitle: context.subtitle,
    carryHint: context.carryHint,
    activeSkillId: conversation.agentState?.activeSkillId,
    activeReferences: referenceIds.size,
    generatedCount: history.length,
    messages: conversation.messages.map((message) => toConversationMessageView(message, assets)),
  };
};

export function buildWorkspaceState(
  store: AppStore,
  selectedConversationId?: string,
): WorkspaceState {
  const conversations = [...store.conversations].sort(byNewestConversation);
  const currentConversation =
    conversations.find((conversation) => conversation.id === selectedConversationId) ??
    conversations[0];

  if (!currentConversation) {
    const fallbackConversation = createEmptyConversation();
    conversations.push(fallbackConversation);
    store.conversations.push(fallbackConversation);
    return buildWorkspaceState(store, fallbackConversation.id);
  }

  return {
    sessions: conversations.map((conversation) =>
      buildSessionSummary(conversation, currentConversation.id),
    ),
    currentSession: buildCurrentSession(currentConversation),
    history: buildHistoryView(currentConversation),
    availableSkills: listSkillManifestsSync(),
    runtime: getRuntimeConfig(),
  };
}

export async function loadWorkspaceState(selectedConversationId?: string) {
  const store = await readStoreRaw();
  return buildWorkspaceState(store, selectedConversationId);
}

export const createEmptyConversation = (title?: string): PersistedConversation => {
  const createdAt = nowIso();

  return {
    id: `session_${randomUUID().slice(0, 8)}`,
    title: title?.trim() || `新会话 ${formatClock(createdAt)}`,
    subtitle: IMAGE_AGENT_PROMPTS.conversationContext.subtitleEmpty,
    carryHint: IMAGE_AGENT_PROMPTS.conversationContext.carryEmpty,
    createdAt,
    updatedAt: createdAt,
    messages: [
      {
        id: `msg_${randomUUID().slice(0, 8)}`,
        role: "assistant",
        text: IMAGE_AGENT_PROMPTS.workspaceText.initialAssistantText,
        createdAt,
        mode: "discuss",
        attachmentIds: [],
      },
    ],
    assets: [],
    jobs: [],
  };
};

export async function createConversation(title?: string) {
  return mutateStore((store) => {
    const conversation = createEmptyConversation(title);
    store.conversations.push(conversation);
    return buildWorkspaceState(store, conversation.id);
  });
}

export async function deleteConversation(conversationId: string) {
  const workspace = await mutateStore((store) => {
    const existingIndex = store.conversations.findIndex((entry) => entry.id === conversationId);

    if (existingIndex === -1) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    store.conversations.splice(existingIndex, 1);

    if (store.conversations.length === 0) {
      const conversation = createEmptyConversation();
      store.conversations.push(conversation);
      return buildWorkspaceState(store, conversation.id);
    }

    return buildWorkspaceState(store);
  });

  await fs.rm(path.join(PUBLIC_MEDIA_DIR, conversationId), {
    recursive: true,
    force: true,
  });

  return workspace;
}

export async function updateConversationSkill(conversationId: string, activeSkillId?: string) {
  return mutateStore((store) => {
    const conversation = getConversationOrThrow(store, conversationId);
    const normalizedSkillId = activeSkillId?.trim() || undefined;
    const availableSkillIds = new Set(listSkillManifestsSync().map((skill) => skill.id));

    if (normalizedSkillId && !availableSkillIds.has(normalizedSkillId)) {
      throw new Error(`Skill not found: ${normalizedSkillId}`);
    }

    const updatedAt = nowIso();
    if (!normalizedSkillId) {
      conversation.agentState = undefined;
    } else {
      const isSameSkill = conversation.agentState?.activeSkillId === normalizedSkillId;
      conversation.agentState = {
        ...(conversation.agentState ?? {}),
        activeSkillId: normalizedSkillId,
        creativeBrief: isSameSkill ? conversation.agentState?.creativeBrief : undefined,
        aPlusArtifacts: isSameSkill ? conversation.agentState?.aPlusArtifacts : undefined,
        openQuestions: isSameSkill ? conversation.agentState?.openQuestions : undefined,
        updatedAt,
      };
    }

    conversation.updatedAt = updatedAt;
    return buildWorkspaceState(store, conversation.id);
  });
}

export async function loadConversationWorkspace(conversationId: string) {
  const store = await readStoreRaw();
  getConversationOrThrow(store, conversationId);
  return buildWorkspaceState(store, conversationId);
}

export function getConversationOrThrow(store: AppStore, conversationId: string) {
  const conversation = store.conversations.find((entry) => entry.id === conversationId);

  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  return conversation;
}

export async function saveBinaryAsset(params: {
  conversationId: string;
  kind: ImageAsset["kind"];
  label: string;
  focus: string;
  mimeType: string;
  buffer: Buffer;
  sourceMessageId?: string;
  derivedFromAssetId?: string;
}): Promise<ImageAsset> {
  const assetId = `asset_${randomUUID().slice(0, 8)}`;
  const extension = mimeTypeToExtension(params.mimeType);
  const assetDir = path.join(PUBLIC_MEDIA_DIR, params.conversationId);
  const fileName = `${assetId}.${extension}`;
  const assetPath = path.join(assetDir, fileName);

  await fs.mkdir(assetDir, { recursive: true });
  await fs.writeFile(assetPath, params.buffer);

  const dimensions = inferDefaultDimensions(params.mimeType);

  return {
    id: assetId,
    kind: params.kind,
    label: params.label,
    alt: `${params.label} preview`,
    focus: params.focus,
    url: `/media/${params.conversationId}/${fileName}`,
    mimeType: params.mimeType,
    width: dimensions.width,
    height: dimensions.height,
    createdAt: nowIso(),
    sourceMessageId: params.sourceMessageId,
    derivedFromAssetId: params.derivedFromAssetId,
  } satisfies ImageAsset;
}

export async function saveInlineBase64Asset(params: {
  conversationId: string;
  kind: ImageAsset["kind"];
  label: string;
  focus: string;
  mimeType: string;
  base64Data: string;
  sourceMessageId?: string;
  derivedFromAssetId?: string;
}) {
  return saveBinaryAsset({
    ...params,
    buffer: Buffer.from(params.base64Data, "base64"),
  });
}

export async function saveRemoteImageAsset(params: {
  conversationId: string;
  kind: ImageAsset["kind"];
  label: string;
  focus: string;
  remoteUrl: string;
  sourceMessageId?: string;
  derivedFromAssetId?: string;
}) {
  const response = await fetch(params.remoteUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to download generated image: ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0] || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());

  const asset = await saveBinaryAsset({
    conversationId: params.conversationId,
    kind: params.kind,
    label: params.label,
    focus: params.focus,
    mimeType: contentType,
    buffer,
    sourceMessageId: params.sourceMessageId,
    derivedFromAssetId: params.derivedFromAssetId,
  });
  asset.externalUrl = params.remoteUrl;

  return asset;
}

export async function imageAssetToInlineReference(asset: ImageAsset): Promise<InlineReferenceImage> {
  const inlineFromDataUrl = parseDataUrl(asset.url);

  if (inlineFromDataUrl) {
    return inlineFromDataUrl;
  }

  const buffer = await fs.readFile(getAssetFilePath(asset));
  return {
    mimeType: asset.mimeType,
    base64Data: buffer.toString("base64"),
  };
}
