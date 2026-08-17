import type {
  AppStore,
  AssetSemanticSummary,
  ImageAsset,
  ImageObservation,
  PersistedConversation,
  PlannerOutput,
  UserPreferenceMemory,
} from "@/lib/types";

const MAX_SUMMARY_LENGTH = 1_600;
const MAX_PREFERENCE_LENGTH = 160;
const MAX_PREFERENCES = 24;

const truncate = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, Math.max(1, max - 1))}…`;

const compactText = (value: string) => value.replace(/\s+/g, " ").trim();

const uniqueStrings = (values: Array<string | undefined>, limit = 12) => {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawValue of values) {
    const value = rawValue?.trim();
    if (!value) {
      continue;
    }
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
};

const normalizePreferenceKey = (value: string) =>
  compactText(value)
    .toLocaleLowerCase()
    .replace(/[，。！？、,.!?;；:："'“”‘’（）()\[\]【】]/g, "");

const sanitizePreference = (value: unknown) =>
  typeof value === "string" && compactText(value)
    ? truncate(compactText(value), MAX_PREFERENCE_LENGTH)
    : undefined;

export const mergeUserPreferenceMemories = (params: {
  current?: UserPreferenceMemory[];
  learned?: string[];
  removed?: string[];
  updatedAt: string;
  sourceConversationId?: string;
}) => {
  const removedKeys = new Set(
    (params.removed ?? [])
      .map(sanitizePreference)
      .filter((value): value is string => Boolean(value))
      .map(normalizePreferenceKey),
  );
  const byKey = new Map<string, UserPreferenceMemory>();

  for (const preference of params.current ?? []) {
    const value = sanitizePreference(preference.value);
    if (!value) {
      continue;
    }
    const key = normalizePreferenceKey(value);
    if (!removedKeys.has(key)) {
      byKey.set(key, { ...preference, value });
    }
  }

  for (const rawValue of params.learned ?? []) {
    const value = sanitizePreference(rawValue);
    if (!value) {
      continue;
    }
    const key = normalizePreferenceKey(value);
    if (!removedKeys.has(key)) {
      byKey.set(key, {
        value,
        updatedAt: params.updatedAt,
        sourceConversationId: params.sourceConversationId,
      });
    }
  }

  return [...byKey.values()]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, MAX_PREFERENCES);
};

export const buildAssetSemanticSummary = (
  asset: ImageAsset,
  observation: ImageObservation,
): AssetSemanticSummary => {
  const palette = uniqueStrings(observation.dominantColors, 5);
  const referenceDimensions = uniqueStrings(
    observation.referenceDimensions?.length
      ? observation.referenceDimensions
      : [
          observation.mainSubject ? "主体与形态" : undefined,
          observation.style ? "视觉风格与光线" : undefined,
          palette.length ? "配色" : undefined,
          observation.compositionHint ? "构图" : undefined,
        ],
    8,
  );
  const editableRegions = uniqueStrings(
    observation.editableRegions?.length
      ? observation.editableRegions
      : [
          observation.mainSubject ? "主体" : undefined,
          "背景",
          "光线与色调",
          observation.containsText ? "文字与排版" : undefined,
          observation.hasLogo ? "品牌标识" : undefined,
        ],
    8,
  );
  const summary = truncate(
    [
      observation.mainSubject || asset.label,
      observation.style,
      palette.length ? `配色：${palette.join("、")}` : undefined,
      observation.compositionHint ? `构图：${observation.compositionHint}` : undefined,
      observation.containsText && observation.ocrText
        ? `可见文字：${observation.ocrText}`
        : undefined,
    ]
      .filter(Boolean)
      .join("；"),
    420,
  );

  return {
    summary,
    subject: observation.mainSubject || undefined,
    style: observation.style || undefined,
    palette,
    composition: observation.compositionHint,
    referenceDimensions,
    editableRegions,
    updatedAt: observation.capturedAt,
  };
};

export const buildFallbackAssetSemanticSummary = (asset: ImageAsset): AssetSemanticSummary => ({
  summary: truncate(
    [asset.label, asset.focus].map(compactText).filter(Boolean).join("；"),
    420,
  ),
  subject: truncate(compactText(asset.label), 120),
  referenceDimensions: ["主体与形态", "配色", "构图", "视觉风格"],
  editableRegions: ["主体", "背景", "光线与色调", "构图与镜头"],
  updatedAt: asset.createdAt,
});

export const buildGeneratedAssetSemanticSummary = (params: {
  label: string;
  prompt: string;
  updatedAt: string;
  referenceAssets?: ImageAsset[];
}): AssetSemanticSummary => {
  const referenceDimensions = uniqueStrings([
    "主体与形态",
    "构图",
    "光线与色调",
    "材质",
    "视觉风格",
  ]);
  const editableRegions = uniqueStrings([
    "主体",
    "背景",
    "光线与色调",
    "构图与镜头",
    "文字与排版",
  ]);
  const referenceNote = params.referenceAssets?.length
    ? `；延续参考：${params.referenceAssets.map((asset) => asset.label).join("、")}`
    : "";

  return {
    summary: truncate(`${params.label}；生成描述：${compactText(params.prompt)}${referenceNote}`, 420),
    subject: truncate(compactText(params.label), 120),
    referenceDimensions,
    editableRegions,
    updatedAt: params.updatedAt,
  };
};

const buildFallbackConversationSummary = (
  conversation: PersistedConversation,
  planner: PlannerOutput,
) => {
  const recentUserRequests = conversation.messages
    .filter((message) => message.role === "user" && message.text.trim())
    .slice(-4)
    .map((message) => compactText(message.text));
  const brief = conversation.agentState?.creativeBrief;
  const parts = [
    conversation.summary?.text,
    conversation.agentState?.activeSkillId
      ? `当前场景：${conversation.agentState.activeSkillId}`
      : undefined,
    brief && Object.keys(brief).length ? `已确认信息：${JSON.stringify(brief)}` : undefined,
    recentUserRequests.length ? `最近需求：${recentUserRequests.join(" / ")}` : undefined,
    `本轮处理：${compactText(planner.assistantReply)}`,
  ].filter(Boolean);

  return truncate(parts.join("\n"), MAX_SUMMARY_LENGTH);
};

export const updateConversationMemory = (params: {
  store: AppStore;
  conversation: PersistedConversation;
  planner: PlannerOutput;
  updatedAt: string;
  sourceMessageId: string;
}) => {
  const memoryUpdate = params.planner.memoryUpdate;
  const llmSummary =
    typeof memoryUpdate?.conversationSummary === "string"
      ? truncate(compactText(memoryUpdate.conversationSummary), MAX_SUMMARY_LENGTH)
      : "";
  // Normal planner calls are schema-required to return an LLM summary. Clean
  // skill runtimes and offline fallbacks do not use that schema, so keep their
  // rolling memory fresh with a deterministic summary instead of letting the
  // unsummarized tail grow forever.
  const summaryText =
    llmSummary || buildFallbackConversationSummary(params.conversation, params.planner);

  if (summaryText) {
    params.conversation.summary = {
      text: summaryText,
      // The assistant message is appended immediately after this update.
      summarizedMessageCount: params.conversation.messages.length + 1,
      updatedAt: params.updatedAt,
      sourceMessageId: params.sourceMessageId,
    };
  }

  params.store.userPreferences = mergeUserPreferenceMemories({
    current: params.store.userPreferences,
    learned: memoryUpdate?.learnedUserPreferences,
    removed: memoryUpdate?.removedUserPreferences,
    updatedAt: params.updatedAt,
    sourceConversationId: params.conversation.id,
  });

};
