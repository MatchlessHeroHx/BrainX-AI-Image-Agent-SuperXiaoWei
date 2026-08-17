import { randomUUID } from "node:crypto";
import {
  buildFallbackError,
  generateWithFallback,
} from "@/lib/ai/image-generation/fallback";
import { getImageRuntime } from "@/lib/ai/image-generation/registry";
import { planNextStep } from "@/lib/agent/planner";
import {
  IMAGE_AGENT_PROMPTS,
} from "@/lib/agent/prompt-config";
import { captureAssetObservations } from "@/lib/agent/perception";
import { listSkillManifestsSync } from "@/lib/agent/skill-registry";
import { schedulePerception } from "@/lib/server/perception-queue";
import { resolveReferenceContext } from "@/lib/server/reference-resolver";
import {
  buildWorkspaceState,
  getConversationOrThrow,
  mutateStore,
  saveBinaryAsset,
  saveInlineBase64Asset,
  saveRemoteImageAsset,
} from "@/lib/server/store";
import {
  buildAssetSemanticSummary,
  buildFallbackAssetSemanticSummary,
  buildGeneratedAssetSemanticSummary,
  updateConversationMemory,
} from "@/lib/server/context-memory";
import type {
  AgentTrace,
  APlusArtifacts,
  APlusBriefFormSpec,
  APlusBriefValues,
  AppStore,
  GenerationAttempt,
  GenerationFormSpec,
  ImageAsset,
  ImageObservation,
  PersistedConversation,
  PlannedGenerationTask,
  PlannerOutput,
  SkillBrief,
  WorkspaceState,
} from "@/lib/types";
import type { ImageModelDefinition, ImageProviderDefinition } from "@/lib/ai/image-models";

type ImageRuntime = {
  provider: ImageProviderDefinition;
  model: ImageModelDefinition;
};

export type MessageStreamEvent =
  | {
      type: "plan_step";
      step: "receive" | "resolve_references" | "plan" | "generate" | "persist";
      status: "start" | "end";
      detail?: string;
    }
  | { type: "reasoning_delta"; delta: string }
  | { type: "text_delta"; delta: string }
  | { type: "image_ready"; asset: ImageAsset; index: number; total: number }
  | { type: "workspace_state"; state: WorkspaceState }
  | { type: "error"; error: { code: string; message: string; recoverable: boolean } }
  | { type: "done" };

export type MessageStreamHandler = (event: MessageStreamEvent) => void;

const nowIso = () => new Date().toISOString();

const STREAM_TARGET_CHUNKS = 72;
const STREAM_CHUNK_DELAY_MS = 18;
const MAX_PUBLIC_REASONING_CHARS = 3_000;

const INTERNAL_REASONING_PATTERN =
  /selectedSkillId|skillConfidence|memoryUpdate|conversationSummary|nextAction|shouldGenerate|reasoningSummary|JSON|schema|system prompt|developer instruction|API[-_ ]?key|字段名|系统提示词|开发者指令/i;

const sanitizePublicReasoningDelta = (delta: string) =>
  delta
    .replace(/sk-[A-Za-z0-9._-]{8,}/g, "[凭证已隐藏]")
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, "[凭证已隐藏]")
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [凭证已隐藏]");

const splitTextForStreaming = (text: string) => {
  const characters = Array.from(text);
  const chunkSize = Math.max(2, Math.ceil(characters.length / STREAM_TARGET_CHUNKS));
  const chunks: string[] = [];

  for (let index = 0; index < characters.length; index += chunkSize) {
    chunks.push(characters.slice(index, index + chunkSize).join(""));
  }

  return chunks;
};

const emitAssistantText = async (params: {
  text: string;
  emit: MessageStreamHandler;
  paced: boolean;
}) => {
  for (const delta of splitTextForStreaming(params.text)) {
    params.emit({ type: "text_delta", delta });
    if (params.paced) {
      await new Promise((resolve) => setTimeout(resolve, STREAM_CHUNK_DELAY_MS));
    }
  }
};

const plannerActionLabels: Record<PlannerOutput["nextAction"], string> = {
  discuss: "直接讨论并给出建议",
  clarify: "先补齐关键信息",
  generate: "准备新的图像生成方案",
  edit: "基于参考图进行编辑",
  reference_generate: "沿用参考图特征生成新图",
  reframe: "调整构图与画幅",
};

const buildPlannerReasoningSummary = (planner: PlannerOutput) => {
  const modelSummary = planner.reasoningSummary?.trim();
  if (modelSummary) {
    return modelSummary;
  }

  const skill = planner.selectedSkillId
    ? listSkillManifestsSync().find((entry) => entry.id === planner.selectedSkillId)
    : undefined;
  const skillText = skill ? `，并采用「${skill.name}」能力` : "";
  return `已判断本轮适合${plannerActionLabels[planner.nextAction]}${skillText}。`;
};

const labelFromPrompt = (prompt: string, fallback: string) => {
  const compact = prompt
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^a-zA-Z0-9\u4e00-\u9fa5]+/, "");

  if (!compact) {
    return fallback;
  }

  return compact.slice(0, 40);
};

const renderLocalPreviewSvg = (params: {
  title: string;
  focus: string;
  prompt: string;
}) => {
  const sanitize = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const title = sanitize(params.title);
  const focus = sanitize(params.focus);
  const prompt = sanitize(params.prompt.slice(0, 120));

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#2d3d54" />
          <stop offset="52%" stop-color="#5d7894" />
          <stop offset="100%" stop-color="#d5a46d" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" fill="url(#bg)" rx="56" />
      <rect x="56" y="56" width="912" height="912" rx="40" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.22)" />
      <circle cx="724" cy="280" r="176" fill="rgba(255,230,202,0.42)" />
      <path d="M118 712 C228 588 380 560 500 618 C598 666 712 662 846 560 L846 900 L118 900 Z" fill="rgba(17,27,39,0.28)" />
      <path d="M160 572 C284 488 392 472 502 514 C628 564 716 550 834 454" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="18" stroke-linecap="round" />
      <g fill="#f6f2ea">
        <text x="116" y="186" font-size="30" letter-spacing="4" font-family="Arial, sans-serif">${sanitize(IMAGE_AGENT_PROMPTS.assetText.localPreviewDirectionLabel)}</text>
        <text x="116" y="254" font-size="78" font-family="Georgia, serif">${title}</text>
        <text x="120" y="744" font-size="28" font-family="Arial, sans-serif">${focus}</text>
        <text x="120" y="802" font-size="22" font-family="Arial, sans-serif">${prompt}</text>
      </g>
    </svg>
  `;
};

async function persistUploadedFiles(params: {
  conversationId: string;
  files: File[];
  sourceMessageId: string;
}) {
  const assets: ImageAsset[] = [];

  for (const [index, file] of params.files.entries()) {
    const mimeType = file.type || "application/octet-stream";
    const buffer = Buffer.from(await file.arrayBuffer());
    const asset = await saveBinaryAsset({
      conversationId: params.conversationId,
      kind: "upload",
      label: file.name || `Upload ${index + 1}`,
      focus: IMAGE_AGENT_PROMPTS.assetText.uploadFocus,
      mimeType,
      buffer,
      sourceMessageId: params.sourceMessageId,
    });
    asset.semanticSummary = buildFallbackAssetSemanticSummary(asset);
    assets.push(asset);

    // Fire-and-forget vision perception. Result writes back to the store when
    // the LLM call completes; if it fails, the rest of the system continues
    // to work on label/focus strings.
    schedulePerception({
      conversationId: params.conversationId,
      assetId: asset.id,
    });
  }

  return assets;
}

const PERCEPTION_SYNC_TIMEOUT_MS = 8_000;

const mergeSkillBrief = (
  current: SkillBrief | undefined,
  next: SkillBrief | undefined,
): SkillBrief | undefined => {
  if (!next || Object.keys(next).length === 0) {
    return current;
  }

  return {
    ...(current ?? {}),
    ...next,
  };
};

const skillBriefString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const normalizeAPlusModule = (value: unknown) => {
  const text = skillBriefString(value);
  if (!text) {
    return undefined;
  }

  const match = /(?:module|模块)\s*0?([1-7])\b/i.exec(text) ?? /^0?([1-7])$/.exec(text);
  return match ? `0${match[1]}`.slice(-2) : undefined;
};

const detectAPlusModuleFromText = (text: string) => {
  const match = /(?:module|模块)\s*0?([1-7])\b/i.exec(text);
  return match ? `0${match[1]}`.slice(-2) : undefined;
};

const captureAPlusArtifacts = (params: {
  current?: APlusArtifacts;
  planner: PlannerOutput;
  updatedAt: string;
  sourceMessageId: string;
}): APlusArtifacts | undefined => {
  const stage = skillBriefString(params.planner.skillBrief?.aPlusStage);
  const selectedModule =
    normalizeAPlusModule(params.planner.skillBrief?.selectedModule) ??
    detectAPlusModuleFromText(params.planner.generation?.prompt ?? params.planner.assistantReply);

  if (params.planner.nextAction === "clarify" || params.planner.needsClarification) {
    return params.current;
  }

  if (!stage && !selectedModule) {
    return params.current;
  }

  const next: APlusArtifacts = {
    ...(params.current ?? {}),
    modulePrompts: params.current?.modulePrompts
      ? { ...params.current.modulePrompts }
      : undefined,
  };

  if (stage === "guidance_template") {
    const text = params.planner.internalArtifacts?.aPlusGuidanceTemplate?.trim() ?? "";
    if (text) {
      next.guidanceTemplate = {
        text,
        updatedAt: params.updatedAt,
        sourceMessageId: params.sourceMessageId,
      };
    }
  }

  const saveModulePrompt = (moduleId: string | undefined, text: string | undefined) => {
    const normalizedModule = normalizeAPlusModule(moduleId);
    const prompt = text?.trim();
    if (!normalizedModule || !prompt) {
      return;
    }

    next.modulePrompts = {
      ...(next.modulePrompts ?? {}),
      [normalizedModule]: {
        text: prompt,
        updatedAt: params.updatedAt,
        sourceMessageId: params.sourceMessageId,
      },
    };
  };

  for (const [moduleId, prompt] of Object.entries(
    params.planner.internalArtifacts?.aPlusModulePrompts ?? {},
  )) {
    saveModulePrompt(moduleId, prompt);
  }

  for (const task of params.planner.generation?.tasks ?? []) {
    saveModulePrompt(task.aPlusModule, task.prompt);
  }

  if (
    selectedModule &&
    (stage === "module_prompt" || stage === "module_image")
  ) {
    const text = (params.planner.generation?.prompt ?? params.planner.assistantReply).trim();
    if (text) {
      saveModulePrompt(selectedModule, text);
    }
  }

  return next.guidanceTemplate || next.modulePrompts ? next : undefined;
};

const updateConversationAgentState = (
  conversation: PersistedConversation,
  planner: PlannerOutput,
  updatedAt: string,
  sourceMessageId: string,
) => {
  if (!planner.selectedSkillId && !planner.skillBrief) {
    return;
  }

  const mergedBrief = mergeSkillBrief(conversation.agentState?.creativeBrief, planner.skillBrief);
  const activeSkillId = planner.selectedSkillId ?? conversation.agentState?.activeSkillId;
  const aPlusArtifacts =
    activeSkillId === "ecommerce-product-image"
      ? captureAPlusArtifacts({
          current: conversation.agentState?.aPlusArtifacts,
          planner,
          updatedAt,
          sourceMessageId,
        })
      : conversation.agentState?.aPlusArtifacts;
  const openQuestions =
    Array.isArray(planner.skillBrief?.openQuestions) &&
    planner.skillBrief.openQuestions.every((entry) => typeof entry === "string")
      ? planner.skillBrief.openQuestions
      : conversation.agentState?.openQuestions;

  conversation.agentState = {
    ...(conversation.agentState ?? {}),
    activeSkillId,
    creativeBrief: mergedBrief,
    aPlusArtifacts,
    openQuestions,
    updatedAt,
  };
};

const applyManualSkillSelection = (
  conversation: PersistedConversation,
  activeSkillId: string | undefined,
  updatedAt: string,
) => {
  const normalizedSkillId = activeSkillId?.trim();

  if (!normalizedSkillId) {
    return;
  }

  const availableSkillIds = new Set(listSkillManifestsSync().map((skill) => skill.id));
  if (!availableSkillIds.has(normalizedSkillId)) {
    throw new Error(`Skill not found: ${normalizedSkillId}`);
  }

  const isSameSkill = conversation.agentState?.activeSkillId === normalizedSkillId;
  conversation.agentState = {
    ...(conversation.agentState ?? {}),
    activeSkillId: normalizedSkillId,
    creativeBrief: isSameSkill ? conversation.agentState?.creativeBrief : undefined,
    aPlusArtifacts: isSameSkill ? conversation.agentState?.aPlusArtifacts : undefined,
    openQuestions: isSameSkill ? conversation.agentState?.openQuestions : undefined,
    updatedAt,
  };
};

/**
 * Capture vision observations for freshly uploaded assets *before* the planner
 * runs, so the LLM — including text-only agent providers that can't see pixels
 * — has real visual facts (subject, style, colors, OCR) to ground intent on.
 *
 * Writes observations directly onto the in-memory asset objects (which are part
 * of the live store being mutated), mirroring how the rest of this mutator
 * touches the store. We intentionally do NOT route through schedulePerception /
 * mutateStore here: processIncomingMessage already runs inside mutateStore, and
 * that queue is serial, so a nested mutateStore would deadlock.
 *
 * Best-effort and time-boxed: any asset whose perception fails or exceeds the
 * timeout is simply left without observations, and the planner still works off
 * the label/focus catalog. A scheduled fire-and-forget pass (queued at upload
 * time) will fill in anything we skip here for later turns.
 */
async function ensureUploadObservations(uploadedAssets: ImageAsset[]) {
  const pending = uploadedAssets.filter(
    (asset) => !asset.observations && asset.mimeType !== "image/svg+xml",
  );

  if (!pending.length) {
    return;
  }

  const captureWithTimeout = async (asset: ImageAsset) => {
    const timeout = new Promise<ImageObservation | null>((resolve) => {
      setTimeout(() => resolve(null), PERCEPTION_SYNC_TIMEOUT_MS);
    });

    try {
      const observation = await Promise.race([
        captureAssetObservations(asset),
        timeout,
      ]);

      if (observation) {
        asset.observations = observation;
        asset.semanticSummary = buildAssetSemanticSummary(asset, observation);
      }
    } catch (error) {
      console.warn("[image-agent] inline upload perception failed", {
        assetId: asset.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await Promise.all(pending.map(captureWithTimeout));
}

const selectReferenceAssets = async (
  conversation: PersistedConversation,
  planner: PlannerOutput,
  uploadedAssets: ImageAsset[],
  explicitReferenceAssets: ImageAsset[],
) => {
  if (!planner.generation) {
    return [];
  }

  const byId = new Map(conversation.assets.map((asset) => [asset.id, asset]));
  for (const asset of uploadedAssets) {
    byId.set(asset.id, asset);
  }

  const selected = planner.generation.referenceAssetIds
    .map((id) => byId.get(id))
    .filter(Boolean) as ImageAsset[];

  if (!planner.generation.inheritConversationContext) {
    if (selected.length) {
      return selected.slice(0, 3);
    }

    if (uploadedAssets.length) {
      return uploadedAssets.slice(0, 3);
    }

    return [];
  }

  if (selected.length) {
    return selected.slice(0, 3);
  }

  if (planner.generation.mode === "edit") {
    if (planner.generation.inheritConversationContext && explicitReferenceAssets.length) {
      return explicitReferenceAssets.slice(0, 3);
    }

    if (uploadedAssets.length) {
      return uploadedAssets.slice(0, 3);
    }

    // Safety net: an edit with no resolved reference (e.g. "你再试一张" / "改上一张"
    // with nothing uploaded this turn) must not dead-end into the
    // missingEditReference clarify. Fall back to the conversation's latest
    // working image — prefer the most recent upload (the user's canonical edit
    // subject), then the most recent generated result for iteration.
    if (planner.generation.inheritConversationContext) {
      const sortedAssets = [...conversation.assets].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      const latestUpload = [...sortedAssets].reverse().find((asset) => asset.kind === "upload");
      const latestGenerated = [...sortedAssets]
        .reverse()
        .find((asset) => asset.kind === "generated");
      const fallback = latestUpload ?? latestGenerated;

      if (fallback) {
        return [fallback];
      }
    }

    return [];
  }

  if (planner.generation.inheritConversationContext && explicitReferenceAssets.length) {
    return explicitReferenceAssets.slice(0, 3);
  }

  if (uploadedAssets.length) {
    return uploadedAssets.slice(0, 3);
  }

  const latestGenerated = [...conversation.assets]
    .reverse()
    .find((asset) => asset.kind === "generated");

  return latestGenerated ? [latestGenerated] : [];
};

async function generateOrFallback(params: {
  conversationId: string;
  prompt: string;
  label?: string;
  focus: string;
  sourceMessageId: string;
  mode: Exclude<PlannerOutput["generation"], null>["mode"];
  derivedFromAssetId?: string;
  referenceAssets: ImageAsset[];
  outputCount: number;
  aspectRatio?: string;
  imageSize?: string;
  imageProviderId?: string;
  imageModelId?: string;
  onAssetReady?: (asset: ImageAsset, index: number, total: number) => void;
}): Promise<{
  usedFallback: boolean;
  assets: ImageAsset[];
  attempts: GenerationAttempt[];
}> {
  const label =
    params.label?.trim() ||
    labelFromPrompt(params.prompt, IMAGE_AGENT_PROMPTS.assetText.defaultGeneratedLabel);
  const outputCount = Math.max(1, Math.round(params.outputCount));
  const derivedFromAssetId =
    params.mode === "generate" ? undefined : params.derivedFromAssetId;
  const runtime = getImageRuntime({
    providerId: params.imageProviderId,
    modelId: params.imageModelId,
  });

  if (!runtime.adapter.isConfigured()) {
    const assets: ImageAsset[] = [];
    for (let index = 0; index < outputCount; index += 1) {
      const variantLabel = outputCount > 1 ? `${label} ${index + 1}` : label;
      const svg = renderLocalPreviewSvg({
        title: variantLabel,
        focus: params.focus,
        prompt: params.prompt,
      });

      const asset = await saveBinaryAsset({
        conversationId: params.conversationId,
        kind: "generated",
        label: variantLabel,
        focus: params.focus,
        mimeType: "image/svg+xml",
        buffer: Buffer.from(svg, "utf8"),
        sourceMessageId: params.sourceMessageId,
        derivedFromAssetId,
      });

      asset.semanticSummary = buildGeneratedAssetSemanticSummary({
        label: variantLabel,
        prompt: params.prompt,
        updatedAt: asset.createdAt,
        referenceAssets: params.referenceAssets,
      });

      assets.push(asset);
      params.onAssetReady?.(asset, index, outputCount);
    }

    return {
      usedFallback: true,
      attempts: [
        {
          strategy: "as-is",
          providerId: runtime.provider.id,
          modelId: runtime.model.id,
          status: "fail",
          errorClass: "config",
          errorMessage: "Provider has no API key configured; using local SVG preview.",
        },
      ],
      assets,
    };
  }

  const aggregatedAttempts: GenerationAttempt[] = [];
  const savedAssets: ImageAsset[] = [];
  for (let index = 0; index < outputCount; index += 1) {
    const outcome = await generateWithFallback({
      prompt: params.prompt,
      mode: params.mode,
      providerId: runtime.provider.id,
      modelId: runtime.model.id,
      aspectRatio: params.aspectRatio,
      imageSize: params.imageSize,
      referenceAssets: params.referenceAssets,
    });

    aggregatedAttempts.push(...outcome.attempts);

    if (!outcome.ok) {
      throw buildFallbackError(outcome);
    }

    const image = outcome.result.images[0];

    if (!image) {
      throw new Error(`${outcome.result.providerName} returned no image outputs.`);
    }

    const variantLabel = outputCount > 1 ? `${label} ${index + 1}` : label;
    let asset: ImageAsset | null = null;
    if (image.base64Data) {
      asset = await saveInlineBase64Asset({
        conversationId: params.conversationId,
        kind: "generated",
        label: variantLabel,
        focus: params.focus,
        mimeType: image.mimeType ?? "image/png",
        base64Data: image.base64Data,
        sourceMessageId: params.sourceMessageId,
        derivedFromAssetId,
      });
    } else if (image.remoteUrl) {
      asset = await saveRemoteImageAsset({
        conversationId: params.conversationId,
        kind: "generated",
        label: variantLabel,
        focus: params.focus,
        remoteUrl: image.remoteUrl,
        sourceMessageId: params.sourceMessageId,
        derivedFromAssetId,
      });
    }

    if (!asset) {
      throw new Error(`${outcome.result.providerName} returned an unsupported image output.`);
    }

    asset.semanticSummary = buildGeneratedAssetSemanticSummary({
      label: variantLabel,
      prompt: params.prompt,
      updatedAt: asset.createdAt,
      referenceAssets: params.referenceAssets,
    });

    savedAssets.push(asset);
    params.onAssetReady?.(asset, index, outputCount);
    schedulePerception({
      conversationId: params.conversationId,
      assetId: asset.id,
    });
  }

  return {
    usedFallback: false,
    attempts: aggregatedAttempts,
    assets: savedAssets,
  };
}

function appendMessage(
  conversation: PersistedConversation,
  message: PersistedConversation["messages"][number],
  uploadedAssets: ImageAsset[] = [],
) {
  conversation.messages.push(message);
  conversation.assets.push(...uploadedAssets);
  conversation.updatedAt = message.createdAt;
}

const DEFAULT_RESOLUTION = "1K";
const A_PLUS_SKILL_ID = "ecommerce-product-image";
const A_PLUS_BRIEF_STAGE = "brief_form";
const A_PLUS_BRIEF_SUBMISSION_PREFIX = "电商图方案信息已确认：";
const isAPlusBriefSubmissionText = (text: string) =>
  text.trim().startsWith(A_PLUS_BRIEF_SUBMISSION_PREFIX);

/**
 * Build the generation form the user fills in before any image is produced.
 * Suggested values are derived from the chosen model's capabilities and the
 * planner's count; the user can override any of them. The actual generation
 * runs later in runGenerationFromForm.
 */
function buildGenerationFormSpec(params: {
  mode: GenerationFormSpec["mode"];
  prompt: string;
  referenceAssetIds: string[];
  tasks?: PlannedGenerationTask[];
  suggestedOutputCount: number;
  runtime: ImageRuntime;
}): GenerationFormSpec {
  const aspectRatios = params.runtime.model.capabilities.aspectRatios;
  const resolutions = params.runtime.model.capabilities.resolutions;
  const suggestedAspectRatio = aspectRatios.includes("1:1")
    ? "1:1"
    : aspectRatios[0] ?? "1:1";
  const suggestedResolution = resolutions.includes(DEFAULT_RESOLUTION)
    ? DEFAULT_RESOLUTION
    : resolutions[0] ?? "";

  return {
    status: "pending",
    mode: params.mode,
    prompt: params.prompt,
    referenceAssetIds: params.referenceAssetIds,
    ...(params.tasks?.length ? { tasks: params.tasks } : {}),
    suggestedAspectRatio,
    suggestedResolution,
    suggestedOutputCount: Math.max(1, Math.round(params.suggestedOutputCount)),
    imageProviderId: params.runtime.provider.id,
    imageModelId: params.runtime.model.id,
  };
}

const skillBriefText = (value: unknown) => {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").join("\n").trim();
  }

  return "";
};

const skillBriefTextList = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  const text = skillBriefText(value);
  return text ? [text] : [];
};

function buildAPlusBriefFormSpec(planner: PlannerOutput): APlusBriefFormSpec {
  const candidateValues = {
    productName: skillBriefTextList(planner.skillBrief?.productNameCandidates),
    sellingPoints: skillBriefTextList(planner.skillBrief?.sellingPointCandidates),
    targetCountry: skillBriefTextList(planner.skillBrief?.targetCountryCandidates),
    salesPlatform: skillBriefTextList(planner.skillBrief?.salesPlatformCandidates),
  };

  return {
    status: "pending",
    initialValues: {
      productName: skillBriefText(planner.skillBrief?.productName),
      sellingPoints: skillBriefText(planner.skillBrief?.sellingPoints),
      targetCountry: skillBriefText(planner.skillBrief?.targetCountry),
      salesPlatform: skillBriefText(planner.skillBrief?.salesPlatform),
    },
    candidateValues: Object.fromEntries(
      Object.entries(candidateValues).filter(([, values]) => values.length > 0),
    ),
  };
}

const isAPlusBriefFormPlanner = (planner: PlannerOutput) =>
  planner.selectedSkillId === A_PLUS_SKILL_ID &&
  skillBriefString(planner.skillBrief?.aPlusStage) === A_PLUS_BRIEF_STAGE &&
  planner.nextAction === "clarify";

async function buildPlannerGenerationTasks(params: {
  conversation: PersistedConversation;
  planner: PlannerOutput;
  uploadedAssets: ImageAsset[];
  explicitReferenceAssets: ImageAsset[];
}): Promise<PlannedGenerationTask[]> {
  if (!params.planner.generation) {
    return [];
  }

  const generation = params.planner.generation;
  const rawTasks = generation.tasks?.length
    ? generation.tasks
    : [
        {
          prompt: generation.prompt,
          referenceAssetIds: generation.referenceAssetIds,
          inheritConversationContext: generation.inheritConversationContext,
        },
      ];
  const tasks: PlannedGenerationTask[] = [];

  for (const task of rawTasks) {
    const taskPlanner: PlannerOutput = {
      ...params.planner,
      generation: {
        ...generation,
        prompt: task.prompt,
        referenceAssetIds: task.referenceAssetIds,
        inheritConversationContext: task.inheritConversationContext,
        tasks: undefined,
      },
    };
    const referenceAssets = await selectReferenceAssets(
      params.conversation,
      taskPlanner,
      params.uploadedAssets,
      params.explicitReferenceAssets,
    );

    tasks.push({
      label: task.label,
      prompt: task.prompt,
      referenceAssetIds: referenceAssets.map((asset) => asset.id),
      inheritConversationContext: task.inheritConversationContext,
      ...(task.aPlusModule ? { aPlusModule: task.aPlusModule } : {}),
    });
  }

  return tasks;
}

const emptyAPlusBriefValues = (): APlusBriefValues => ({
  productName: "",
  sellingPoints: "",
  targetCountry: "",
  salesPlatform: "",
});

function parseAPlusBriefSubmission(text: string): APlusBriefValues | undefined {
  if (!isAPlusBriefSubmissionText(text)) {
    return undefined;
  }

  const values = emptyAPlusBriefValues();
  let activeKey: keyof APlusBriefValues | undefined;

  for (const rawLine of text.split("\n").slice(1)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const assign = (key: keyof APlusBriefValues, prefix: string) => {
      values[key] = line.slice(prefix.length).trim();
      activeKey = key;
    };

    if (line.startsWith("产品名称：")) {
      assign("productName", "产品名称：");
      continue;
    }
    if (line.startsWith("重点突出的卖点：")) {
      assign("sellingPoints", "重点突出的卖点：");
      continue;
    }
    if (line.startsWith("目标国家 / 地区：")) {
      assign("targetCountry", "目标国家 / 地区：");
      continue;
    }
    if (line.startsWith("销售平台：")) {
      assign("salesPlatform", "销售平台：");
      continue;
    }
    if (line.startsWith("请先基于") || line.startsWith("用户未补充")) {
      activeKey = undefined;
      continue;
    }
    if (activeKey) {
      values[activeKey] = values[activeKey]
        ? `${values[activeKey]}\n${line}`
        : line;
    }
  }

  return values;
}

function markAPlusBriefFormSubmitted(
  conversation: PersistedConversation,
  values: APlusBriefValues,
) {
  const pendingFormMessage = [...conversation.messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        message.aPlusBriefForm &&
        message.aPlusBriefForm.status === "pending",
    );

  if (!pendingFormMessage?.aPlusBriefForm) {
    return;
  }

  pendingFormMessage.aPlusBriefForm = {
    ...pendingFormMessage.aPlusBriefForm,
    status: "submitted",
    submittedValues: values,
  };
}

function mergeSubmittedAPlusBrief(
  conversation: PersistedConversation,
  values: APlusBriefValues,
  updatedAt: string,
) {
  const brief: SkillBrief = {
    shotType: "A+ 套图",
    aPlusStage: "guidance_template",
    aPlusBriefCollected: true,
  };

  if (values.productName) {
    brief.productName = values.productName;
  }
  if (values.sellingPoints) {
    brief.sellingPoints = values.sellingPoints;
  }
  if (values.targetCountry) {
    brief.targetCountry = values.targetCountry;
  }
  if (values.salesPlatform) {
    brief.salesPlatform = values.salesPlatform;
    brief.targetChannel = values.salesPlatform;
  }

  conversation.agentState = {
    ...(conversation.agentState ?? {}),
    activeSkillId: A_PLUS_SKILL_ID,
    creativeBrief: mergeSkillBrief(conversation.agentState?.creativeBrief, brief),
    aPlusArtifacts: conversation.agentState?.aPlusArtifacts,
    openQuestions: conversation.agentState?.openQuestions,
    updatedAt,
  };
}

export async function processIncomingMessage(params: {
  conversationId: string;
  text: string;
  files: File[];
  explicitReferenceAssetIds: string[];
  imageProviderId?: string;
  imageModelId?: string;
  agentProviderId?: string;
  agentModelId?: string;
  activeSkillId?: string;
  onEvent?: MessageStreamHandler;
}): Promise<WorkspaceState> {
  const normalizedText = params.text.trim();
  const emit = params.onEvent ?? (() => undefined);
  const reasoningParts: string[] = [];
  let streamedModelReasoning = "";
  let pendingModelReasoning = "";
  const addReasoning = (text: string) => {
    const normalized = text.trim();
    if (!normalized) {
      return;
    }
    reasoningParts.push(normalized);
    emit({ type: "reasoning_delta", delta: `${normalized}\n` });
  };
  const currentReasoning = () => reasoningParts.join("\n");
  const emitModelReasoningSegment = (rawSegment: string) => {
    const remaining = MAX_PUBLIC_REASONING_CHARS - streamedModelReasoning.length;
    if (remaining <= 0) {
      return;
    }

    const normalizedSegment = sanitizePublicReasoningDelta(rawSegment)
      .replace(/\s*\n+\s*/g, " ")
      .trim();
    const segment = normalizedSegment
      ? `${normalizedSegment.slice(0, Math.max(0, remaining - 1))}\n`
      : "";
    const hanCount = segment.match(/[\u3400-\u9fff]/g)?.length ?? 0;
    const latinCount = segment.match(/[A-Za-z]/g)?.length ?? 0;
    if (
      !segment.trim() ||
      INTERNAL_REASONING_PATTERN.test(segment) ||
      (latinCount > 24 && latinCount > hanCount * 2)
    ) {
      return;
    }

    streamedModelReasoning += segment;
    emit({ type: "reasoning_delta", delta: segment });
  };
  const appendModelReasoning = (rawDelta: string) => {
    pendingModelReasoning += rawDelta;

    while (true) {
      const boundary = /[。！？!?]\s*|\n+/.exec(pendingModelReasoning);
      if (!boundary || boundary.index === undefined) {
        break;
      }

      const end = boundary.index + boundary[0].length;
      emitModelReasoningSegment(pendingModelReasoning.slice(0, end));
      pendingModelReasoning = pendingModelReasoning.slice(end);
    }
  };
  const streamReply = (text: string) =>
    emitAssistantText({ text, emit, paced: Boolean(params.onEvent) });

  if (!normalizedText && params.files.length === 0) {
    throw new Error("Message text or images are required.");
  }

  return mutateStore(async (store: AppStore) => {
    emit({ type: "plan_step", step: "receive", status: "start" });
    const conversation = getConversationOrThrow(store, params.conversationId);
    applyManualSkillSelection(conversation, params.activeSkillId, nowIso());
    const explicitReferenceAssets = Array.from(new Set(params.explicitReferenceAssetIds))
      .map((assetId) => conversation.assets.find((asset) => asset.id === assetId))
      .filter(Boolean) as ImageAsset[];
    const userMessageId = `msg_${randomUUID().slice(0, 8)}`;
    const createdAt = nowIso();
    const uploadedAssets = await persistUploadedFiles({
      conversationId: conversation.id,
      files: params.files,
      sourceMessageId: userMessageId,
    });

    appendMessage(
      conversation,
      {
        id: userMessageId,
        role: "user",
        text: normalizedText,
        createdAt,
        mode: uploadedAssets.length ? "reference_generate" : "generate",
        attachmentIds: uploadedAssets.map((asset) => asset.id),
      },
      uploadedAssets,
    );
    const submittedAPlusBrief = parseAPlusBriefSubmission(normalizedText);
    if (submittedAPlusBrief) {
      markAPlusBriefFormSubmitted(conversation, submittedAPlusBrief);
      mergeSubmittedAPlusBrief(conversation, submittedAPlusBrief, createdAt);
    }
    emit({ type: "plan_step", step: "receive", status: "end" });
    addReasoning(
      uploadedAssets.length
        ? `已接收本轮文字与 ${uploadedAssets.length} 张上传图。`
        : "已接收本轮消息。",
    );

    emit({ type: "plan_step", step: "resolve_references", status: "start" });
    const resolvedReferences = resolveReferenceContext({
      conversation,
      userText: normalizedText,
      uploadedAssets,
      explicitReferenceAssetIds: explicitReferenceAssets.map((asset) => asset.id),
    });
    emit({ type: "plan_step", step: "resolve_references", status: "end" });
    const resolvedReferenceCount = new Set([
      ...explicitReferenceAssets.map((asset) => asset.id),
      ...resolvedReferences.inferredAssetIds,
      ...uploadedAssets.map((asset) => asset.id),
    ]).size;
    addReasoning(
      resolvedReferenceCount > 0
        ? `已确认本轮需要结合 ${resolvedReferenceCount} 张参考图。`
        : "已检查上下文，本轮不依赖已有参考图。",
    );

    // Capture observations for freshly uploaded images before planning, so the
    // agent LLM (vision or text-only) can ground intent on real visual facts.
    // The planner — not a regex short-circuit — decides whether the turn is an
    // image inspection, a discussion, an edit, or a fresh generation.
    if (uploadedAssets.length) {
      await ensureUploadObservations(uploadedAssets);
    }

    emit({ type: "plan_step", step: "plan", status: "start" });
    emit({
      type: "reasoning_delta",
      delta: "正在结合会话上下文、参考关系与可用能力判断下一步…\n",
    });
    const planner = await planNextStep({
      conversation,
      userText: normalizedText,
      uploadedAssets,
      explicitReferenceAssetIds: explicitReferenceAssets.map((asset) => asset.id),
      inferredReferenceAssetIds: resolvedReferences.inferredAssetIds,
      userPreferences: store.userPreferences.map((preference) => preference.value),
      agentProviderId: params.agentProviderId,
      agentModelId: params.agentModelId,
      onReasoningDelta: params.onEvent ? appendModelReasoning : undefined,
    });
    emit({
      type: "plan_step",
      step: "plan",
      status: "end",
      detail: planner.nextAction,
    });
    emitModelReasoningSegment(pendingModelReasoning);
    pendingModelReasoning = "";
    if (streamedModelReasoning.trim()) {
      reasoningParts.push(streamedModelReasoning.trim());
    }
    addReasoning(buildPlannerReasoningSummary(planner));
    const userMessage = conversation.messages.find((message) => message.id === userMessageId);
    if (userMessage) {
      userMessage.mode = planner.generation?.mode ?? planner.nextAction;
    }

    const assistantMessageId = `msg_${randomUUID().slice(0, 8)}`;
    const memoryUpdatedAt = nowIso();
    updateConversationMemory({
      store,
      conversation,
      planner,
      updatedAt: memoryUpdatedAt,
      sourceMessageId: assistantMessageId,
    });
    updateConversationAgentState(
      conversation,
      planner,
      memoryUpdatedAt,
      assistantMessageId,
    );
    const baseTrace: AgentTrace = {
      referenceResolution: {
        inferredAssetIds: resolvedReferences.inferredAssetIds,
        note: resolvedReferences.resolutionNote,
        hardReset: resolvedReferences.hardReset,
      },
      planning: {
        action: planner.nextAction,
        shouldGenerate: planner.shouldGenerate,
        referenceAssetIds: planner.generation?.referenceAssetIds ?? [],
        inheritConversationContext: planner.generation?.inheritConversationContext,
        selectedSkillId: planner.selectedSkillId,
        skillConfidence: planner.skillConfidence,
        skillBrief: planner.skillBrief,
        memoryUpdate: planner.memoryUpdate,
        rationale: planner.reasoningSummary,
      },
    };

    if (!planner.shouldGenerate || !planner.generation) {
      const aPlusBriefForm = isAPlusBriefFormPlanner(planner)
        ? buildAPlusBriefFormSpec(planner)
        : undefined;

      appendMessage(conversation, {
        id: assistantMessageId,
        role: "assistant",
        text: planner.assistantReply,
        reasoning: currentReasoning(),
        createdAt: nowIso(),
        mode: planner.nextAction,
        attachmentIds: [],
        debugTrace: baseTrace,
        aPlusBriefForm,
      });

      await streamReply(planner.assistantReply);
      const state = buildWorkspaceState(store, conversation.id);
      emit({ type: "workspace_state", state });
      return state;
    }

    const explicitAndInferredReferenceAssets = [
      ...explicitReferenceAssets,
      ...resolvedReferences.inferredAssetIds
        .map((assetId: string) => conversation.assets.find((asset) => asset.id === assetId))
        .filter(Boolean),
    ] as ImageAsset[];
    const generationTasks = await buildPlannerGenerationTasks({
      conversation,
      planner,
      uploadedAssets,
      explicitReferenceAssets: explicitAndInferredReferenceAssets,
    });
    const referenceAssetIds = generationTasks[0]?.referenceAssetIds ?? [];

    if (
      planner.generation.mode === "edit" &&
      (generationTasks.length === 0 ||
        generationTasks.some((task) => task.referenceAssetIds.length === 0))
    ) {
      addReasoning("缺少可编辑的参考图，因此先暂停编辑并向你确认素材。");
      const reply = IMAGE_AGENT_PROMPTS.fallbackAssistantReplies.missingEditReferenceClarify;
      appendMessage(conversation, {
        id: assistantMessageId,
        role: "assistant",
        text: reply,
        reasoning: currentReasoning(),
        createdAt: nowIso(),
        mode: "clarify",
        attachmentIds: [],
        debugTrace: {
          ...baseTrace,
          errorMessage: "Missing reference for edit; downgraded to clarify.",
        },
      });

      await streamReply(reply);
      const state = buildWorkspaceState(store, conversation.id);
      emit({ type: "workspace_state", state });
      return state;
    }

    const selectedRuntime = getImageRuntime({
      providerId: params.imageProviderId,
      modelId: params.imageModelId,
    });

    // The agent has decided WHAT to draw (mode/prompt/references) but never the
    // output parameters. Instead of generating now, surface a fillable form and
    // let the user confirm aspect ratio / resolution / count. Generation runs
    // later via runGenerationFromForm once the form is submitted.
    const formSpec = buildGenerationFormSpec({
      mode: planner.generation.mode,
      prompt: planner.generation.prompt,
      referenceAssetIds,
      tasks: generationTasks,
      suggestedOutputCount: planner.generation.outputCount,
      runtime: selectedRuntime,
    });

    appendMessage(conversation, {
      id: assistantMessageId,
      role: "assistant",
      text: planner.assistantReply,
      reasoning: currentReasoning(),
      createdAt: nowIso(),
      mode: planner.generation.mode,
      attachmentIds: [],
      debugTrace: baseTrace,
      generationForm: formSpec,
    });

    await streamReply(planner.assistantReply);
    const state = buildWorkspaceState(store, conversation.id);
    emit({ type: "plan_step", step: "persist", status: "end" });
    emit({ type: "workspace_state", state });
    return state;
  });
}

export type FormGenerationParamsInput = {
  aspectRatio?: string;
  resolution?: string;
  outputCount?: number;
};

const clampOutputCount = (value: number | undefined, fallback: number) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return Math.max(1, Math.min(8, Math.round(fallback)));
  }
  return Math.max(1, Math.min(8, Math.round(value)));
};

const getGenerationFormTasks = (form: GenerationFormSpec): PlannedGenerationTask[] =>
  form.tasks?.length
    ? form.tasks
    : [
        {
          prompt: form.prompt,
          referenceAssetIds: form.referenceAssetIds,
          inheritConversationContext: true,
        },
      ];

/**
 * Run the generation a user confirmed via the parameter form. Looks up the
 * pending form message, generates with the user-chosen aspect ratio / resolution
 * / count, attaches the resulting images to that same message and flips the form
 * to "submitted". On failure the form stays "pending" so the user can retry.
 */
export async function runGenerationFromForm(params: {
  conversationId: string;
  messageId: string;
  formParams: FormGenerationParamsInput;
  imageProviderId?: string;
  imageModelId?: string;
  onEvent?: MessageStreamHandler;
}): Promise<WorkspaceState> {
  const emit = params.onEvent ?? (() => undefined);

  return mutateStore(async (store: AppStore) => {
    const conversation = getConversationOrThrow(store, params.conversationId);
    const message = conversation.messages.find((entry) => entry.id === params.messageId);

    if (!message || !message.generationForm) {
      throw new Error("No generation form found for this message.");
    }

    const form = message.generationForm;

    if (form.status === "submitted") {
      // Idempotent: the form was already generated. Return current state.
      const state = buildWorkspaceState(store, conversation.id);
      emit({ type: "workspace_state", state });
      return state;
    }

    const selectedRuntime = getImageRuntime({
      providerId: params.imageProviderId ?? form.imageProviderId,
      modelId: params.imageModelId ?? form.imageModelId,
    });
    const capabilities = selectedRuntime.model.capabilities;

    const aspectRatio =
      params.formParams.aspectRatio && capabilities.aspectRatios.includes(params.formParams.aspectRatio)
        ? params.formParams.aspectRatio
        : form.suggestedAspectRatio && capabilities.aspectRatios.includes(form.suggestedAspectRatio)
          ? form.suggestedAspectRatio
          : undefined;
    const resolution =
      params.formParams.resolution && capabilities.resolutions.includes(params.formParams.resolution)
        ? params.formParams.resolution
        : capabilities.resolutions.includes(form.suggestedResolution)
          ? form.suggestedResolution
          : "";
    const outputCount = clampOutputCount(
      params.formParams.outputCount,
      form.suggestedOutputCount,
    );

    const formTasks = getGenerationFormTasks(form);
    const referenceAssetIds = Array.from(
      new Set(formTasks.flatMap((task) => task.referenceAssetIds)),
    );
    const promptForModel =
      formTasks.length > 1
        ? formTasks
            .map(
              (task, index) =>
                `${index + 1}. ${task.label ? `${task.label}\n` : ""}${task.prompt}`,
            )
            .join("\n\n")
        : form.prompt;

    const jobId = `job_${randomUUID().slice(0, 8)}`;
    const jobCreatedAt = nowIso();
    conversation.jobs.push({
      id: jobId,
      triggerMessageId: message.id,
      status: "running",
      mode: form.mode,
      promptForModel,
      referenceAssetIds,
      outputAssetIds: [],
      createdAt: jobCreatedAt,
      updatedAt: jobCreatedAt,
      imageProviderId: selectedRuntime.provider.id,
      imageModelId: selectedRuntime.model.id,
    });

    const existingTrace: AgentTrace = message.debugTrace ?? {};
    const generatedAssets: ImageAsset[] = [];
    const aggregatedAttempts: GenerationAttempt[] = [];
    let usedFallback = false;
    let readyIndex = 0;
    const totalImages = formTasks.length * outputCount;

    emit({ type: "plan_step", step: "generate", status: "start" });
    try {
      for (const task of formTasks) {
        const referenceAssets = task.referenceAssetIds
          .map((assetId) => conversation.assets.find((asset) => asset.id === assetId))
          .filter(Boolean) as ImageAsset[];
        const generation = await generateOrFallback({
          conversationId: conversation.id,
          prompt: task.prompt,
          label: task.label,
          focus: task.label ? `${message.text}\n${task.label}` : message.text,
          sourceMessageId: message.id,
          mode: form.mode,
          derivedFromAssetId: referenceAssets[0]?.id,
          referenceAssets,
          outputCount,
          aspectRatio,
          imageSize: resolution || undefined,
          imageProviderId: selectedRuntime.provider.id,
          imageModelId: selectedRuntime.model.id,
          onAssetReady: (asset) => {
            emit({ type: "image_ready", asset, index: readyIndex, total: totalImages });
            readyIndex += 1;
          },
        });

        generatedAssets.push(...generation.assets);
        aggregatedAttempts.push(...generation.attempts);
        usedFallback = usedFallback || generation.usedFallback;
      }
      emit({ type: "plan_step", step: "generate", status: "end" });

      // Attach generated assets to the existing form message and mark submitted.
      conversation.assets.push(...generatedAssets);
      message.attachmentIds = generatedAssets.map((asset) => asset.id);
      message.mode = form.mode;
      message.generationForm = {
        ...form,
        status: "submitted",
        submittedParams: { aspectRatio: aspectRatio ?? "", resolution, outputCount },
      };
      message.debugTrace = {
        ...existingTrace,
        generation: {
          providerId: selectedRuntime.provider.id,
          modelId: selectedRuntime.model.id,
          usedFallback,
          attempts: aggregatedAttempts,
        },
      };
      conversation.updatedAt = nowIso();

      const job = conversation.jobs.find((entry) => entry.id === jobId);
      if (job) {
        job.status = "succeeded";
        job.outputAssetIds = generatedAssets.map((asset) => asset.id);
        job.updatedAt = nowIso();
        job.attempts = aggregatedAttempts;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown generation failure";
      const attempts = [
        ...aggregatedAttempts,
        ...((error as { attempts?: GenerationAttempt[] } | undefined)?.attempts ?? []),
      ];

      // Keep the form pending so the user can adjust params and retry.
      message.debugTrace = {
        ...existingTrace,
        generation: {
          providerId: selectedRuntime.provider.id,
          modelId: selectedRuntime.model.id,
          usedFallback: false,
          attempts,
        },
        errorMessage,
      };

      const job = conversation.jobs.find((entry) => entry.id === jobId);
      if (job) {
        job.status = "failed";
        job.errorMessage = errorMessage;
        job.updatedAt = nowIso();
        job.attempts = attempts;
      }

      emit({ type: "plan_step", step: "generate", status: "end", detail: "failed" });
      emit({
        type: "error",
        error: {
          code: (error as { errorClass?: string } | undefined)?.errorClass ?? "unknown",
          message: errorMessage,
          recoverable: true,
        },
      });
    }

    const state = buildWorkspaceState(store, conversation.id);
    emit({ type: "plan_step", step: "persist", status: "end" });
    emit({ type: "workspace_state", state });
    return state;
  });
}

export const __messageServiceTestHooks = {
  ensureUploadObservations,
  captureAPlusArtifacts,
  selectReferenceAssets,
  buildAPlusBriefFormSpec,
  isAPlusBriefFormPlanner,
  parseAPlusBriefSubmission,
};
