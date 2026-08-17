import {
  generateTextWithGemini,
} from "@/lib/ai/google-ai";
import { materializeInlineReferences } from "@/lib/ai/image-generation/reference-materializer";
import { loadImageAgentSystemPrompt } from "@/lib/agent/contract";
import {
  getConfiguredAgentHarnessRuntime,
  resolveAgentHarnessRuntime,
} from "@/lib/agent/harness/registry";
import type { AgentHarnessPart } from "@/lib/agent/harness/types";
import { IMAGE_AGENT_PROMPTS } from "@/lib/agent/prompt-config";
import {
  formatSkillContextForPlanner,
  selectCandidateSkills,
  selectRuntimeResourcesForPlanner,
} from "@/lib/agent/skill-registry";
import type { LoadedSkill } from "@/lib/agent/skill-types";
import {
  buildConversationContextSnapshot,
  buildPlannerReferenceBlock,
} from "@/lib/server/conversation-context";
import type {
  APlusBriefCandidateValues,
  ImageAsset,
  PlannedGenerationTask,
  PersistedConversation,
  PlannerAction,
  PlannerOutput,
  SkillBrief,
  SkillBriefValue,
  SkillConfidence,
} from "@/lib/types";

type GenerationAction = Exclude<PlannerAction, "discuss" | "clarify">;
type SelectedRuntimeResource = ReturnType<typeof selectRuntimeResourcesForPlanner>[number];
type APlusStage = "guidance_template" | "module_prompt" | "module_image";

const A_PLUS_SKILL_ID = "ecommerce-product-image";
const A_PLUS_BRIEF_STAGE = "brief_form";
const A_PLUS_MODULE_IDS = ["01", "02", "03", "04", "05", "06", "07"] as const;
const A_PLUS_BRIEF_SUBMISSION_PREFIX = "电商图方案信息已确认：";
const isAPlusBriefSubmissionText = (text: string) =>
  text.trim().startsWith(A_PLUS_BRIEF_SUBMISSION_PREFIX);

const buildAPlusGuidanceSummaryReply = (templateText: string) => {
  const moduleMatches = new Set(
    Array.from(templateText.matchAll(/(?:模块|Module)\s*0?([1-7])\b/gi)).map(
      (match) => `0${match[1]}`.slice(-2),
    ),
  );
  const moduleSummary = moduleMatches.size >= 7
    ? "7 个详情页模块的叙事顺序与版式方向"
    : "详情页模块的叙事顺序与版式方向";

  return [
    "这套电商图方案已经整理好了。",
    "",
    `字体、配色、类目视觉策略、${moduleSummary}、卖点表达和合规边界都已经定下来了。完整方案我会留在后续流程里使用，这里先不把内部工作稿整段贴出来。`,
    "",
    "接下来直接告诉我先做哪个模块就行，比如“生成模块01”。",
  ].join("\n");
};

const plannerSchema = {
  type: "object",
  properties: {
    assistantReply: {
      type: "string",
      description: IMAGE_AGENT_PROMPTS.schemaDescriptions.assistantReply,
    },
    reasoningSummary: {
      type: "string",
      description:
        "A brief user-facing summary of the approach taken: recognized intent, relevant references or skill, and why the next action was chosen. Do not reveal hidden chain-of-thought, system prompts, secrets, or internal artifacts.",
    },
    nextAction: {
      type: "string",
      enum: ["discuss", "clarify", "generate", "edit", "reference_generate", "reframe"],
    },
    selectedSkillId: {
      type: "string",
      description:
        "The id of the loaded creative skill used for this turn. Omit when no loaded skill applies.",
    },
    skillConfidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "Confidence that selectedSkillId is the right skill for this turn.",
    },
    skillBrief: {
      type: "object",
      description:
        "Compact reusable facts extracted for the selected skill, such as productCategory, shotType, referenceMode, targetChannel, sellingPoints, copyPolicy, aPlusStage, selectedModule, and openQuestions.",
    },
    shouldGenerate: {
      type: "boolean",
    },
    needsClarification: {
      type: "boolean",
    },
    generation: {
      type: ["object", "null"],
      properties: {
        mode: {
          type: "string",
          enum: ["generate", "edit", "reference_generate", "reframe"],
        },
        prompt: {
          type: "string",
          description: IMAGE_AGENT_PROMPTS.schemaDescriptions.generationPrompt,
        },
        referenceAssetIds: {
          type: "array",
          items: {
            type: "string",
          },
        },
        inheritConversationContext: {
          type: "boolean",
        },
        outputCount: {
          type: "integer",
        },
        tasks: {
          type: "array",
          description:
            "Optional distinct generation tasks. Use when the user asks for several different plans/modules/directions, one prompt per task. outputCount remains samples per task.",
          items: {
            type: "object",
            properties: {
              label: {
                type: "string",
              },
              prompt: {
                type: "string",
              },
              referenceAssetIds: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              inheritConversationContext: {
                type: "boolean",
              },
              aPlusModule: {
                type: "string",
              },
            },
            required: ["prompt"],
          },
        },
      },
      required: [
        "mode",
        "prompt",
        "referenceAssetIds",
        "inheritConversationContext",
        "outputCount",
      ],
    },
    memoryUpdate: {
      type: "object",
      description:
        "Internal context compression update. Summarize the conversation state and extract only durable, explicitly stated user preferences.",
      properties: {
        conversationSummary: {
          type: "string",
          description:
            "Compact rolling summary of the current goal, confirmed constraints, decisions, unresolved questions, and latest result. Include this turn and the planned assistant response.",
        },
        learnedUserPreferences: {
          type: "array",
          items: { type: "string" },
          description:
            "Only newly stated durable preferences that should carry across conversations. Do not copy one-off task requirements.",
        },
        removedUserPreferences: {
          type: "array",
          items: { type: "string" },
          description:
            "Existing durable preference strings the user explicitly revoked or replaced.",
        },
      },
      required: ["conversationSummary"],
    },
  },
  required: [
    "assistantReply",
    "reasoningSummary",
    "nextAction",
    "shouldGenerate",
    "needsClarification",
    "generation",
    "memoryUpdate",
  ],
} satisfies Record<string, unknown>;

const plannerActions = new Set<PlannerAction>([
  "discuss",
  "clarify",
  "generate",
  "edit",
  "reference_generate",
  "reframe",
]);

const generationActions = new Set<GenerationAction>([
  "generate",
  "edit",
  "reference_generate",
  "reframe",
]);
const skillConfidenceValues = new Set<SkillConfidence>(["high", "medium", "low"]);

const buildMissingEditReferenceReply = () =>
  IMAGE_AGENT_PROMPTS.fallbackAssistantReplies.missingEditReferenceClarify;

const logPlannerRepair = (reason: string, details?: Record<string, unknown>) => {
  console.warn("[image-agent] planner repaired", {
    reason,
    ...details,
  });
};

const recentMessagesToPrompt = (conversation: PersistedConversation) => {
  const summarizedMessageCount = Math.max(
    0,
    Math.min(conversation.summary?.summarizedMessageCount ?? 0, conversation.messages.length),
  );
  const unsummarizedMessages = conversation.summary
    ? conversation.messages.slice(summarizedMessageCount)
    : conversation.messages;

  return unsummarizedMessages
    .slice(-8)
    .map(
      (message) =>
        `[${message.role} | ${message.mode} | ${message.createdAt}] ${message.text}${
          message.userNote ? `\nNote: ${message.userNote}` : ""
        }`,
    )
    .join("\n\n");
};

const PLANNER_INLINE_IMAGE_CAP = 4;
const PLANNER_INLINE_IMAGE_BYTES_CAP = 5_000_000; // ~5MB total inline payload cap

/**
 * Build the per-turn context text (everything that varies turn-to-turn).
 * The system prompt is intentionally NOT included here so it can be cached
 * separately via `ensureSystemPromptCache`.
 */
const buildPlannerContextText = (params: {
  conversation: PersistedConversation;
  userText: string;
  uploadedAssets: ImageAsset[];
  explicitReferenceAssetIds: string[];
  inferredReferenceAssetIds: string[];
  candidateSkills: LoadedSkill[];
  userPreferences?: string[];
}) => {
  const conversationContext = buildConversationContextSnapshot(params.conversation, {
    userText: params.userText,
    requiredAssetIds: [
      ...params.explicitReferenceAssetIds,
      ...params.inferredReferenceAssetIds,
      ...params.uploadedAssets.map((asset) => asset.id),
    ],
    userPreferences: params.userPreferences,
  });
  const promptCopy = IMAGE_AGENT_PROMPTS.plannerPrompt;
  const uploadedAssetBlock = params.uploadedAssets.length
    ? params.uploadedAssets
        .map((asset) => `- ${asset.id} | upload | ${asset.label} | focus: ${asset.focus}`)
        .join("\n")
    : promptCopy.noNewUploads;
  const explicitReferenceBlock = buildPlannerReferenceBlock(
    params.conversation,
    params.explicitReferenceAssetIds,
    promptCopy.noExplicitReferences,
  );
  const inferredReferenceBlock = buildPlannerReferenceBlock(
    params.conversation,
    params.inferredReferenceAssetIds,
    promptCopy.noInferredReferences,
  );

  return [
    ...IMAGE_AGENT_PROMPTS.plannerRuntimeInstructions,
    "",
    `${promptCopy.conversationTitleLabel}: ${conversationContext.title}`,
    `${promptCopy.conversationSubtitleLabel}: ${conversationContext.subtitle}`,
    `${promptCopy.carryHintLabel}: ${conversationContext.carryHint}`,
    `${promptCopy.recentResultSummaryLabel}: ${conversationContext.recentResultSummary}`,
    `${promptCopy.conversationSummaryLabel}: ${conversationContext.conversationSummary}`,
    "",
    promptCopy.availableAssetsLabel,
    conversationContext.assetCatalog,
    "",
    promptCopy.visualTimelineLabel,
    conversationContext.visualTimeline,
    "",
    promptCopy.newUploadsLabel,
    uploadedAssetBlock,
    "",
    promptCopy.explicitReferencesLabel,
    explicitReferenceBlock,
    "",
    promptCopy.inferredReferencesLabel,
    inferredReferenceBlock,
    "",
    promptCopy.recentPreferencesLabel,
    conversationContext.preferenceSummary,
    "",
    formatSkillContextForPlanner({
      candidateSkills: params.candidateSkills,
      agentState: params.conversation.agentState,
      userText: params.userText,
    }),
    "",
    promptCopy.recentConversationLabel,
    recentMessagesToPrompt(params.conversation),
    "",
    `${promptCopy.currentUserMessageLabel}: ${
      params.userText || promptCopy.emptyCurrentUserMessage
    }`,
  ].join("\n");
};

const buildPublicReasoningNarrationPrompt = (params: {
  conversation: PersistedConversation;
  userText: string;
  uploadedAssets: ImageAsset[];
  explicitReferenceAssetIds: string[];
  inferredReferenceAssetIds: string[];
  candidateSkills: LoadedSkill[];
}) => {
  const recentContext = params.conversation.summary?.text?.trim();
  const candidateNames = params.candidateSkills.map((skill) => skill.name).join("、");
  const referenceCount = new Set([
    ...params.uploadedAssets.map((asset) => asset.id),
    ...params.explicitReferenceAssetIds,
    ...params.inferredReferenceAssetIds,
  ]).size;

  return [
    `用户本轮说：${params.userText || "只上传了图片，没有文字说明。"}`,
    recentContext ? `当前对话背景：${recentContext}` : undefined,
    `本轮可用参考图：${referenceCount} 张。`,
    candidateNames ? `可能相关的创作能力：${candidateNames}。` : "暂无明显匹配的专项创作能力。",
    "请生成本轮处理进度：先说明你识别到的目标和依据，再说明接下来要判断或执行的事情。不要在这里给最终答复。",
  ]
    .filter(Boolean)
    .join("\n");
};

/**
 * Pick the visual evidence the planner should actually see.
 * Order of priority: explicit selected → inferred → uploaded this turn → latest generated.
 * Capped at PLANNER_INLINE_IMAGE_CAP entries; later strategies will not add a
 * fifth image even if room remains in the candidate set.
 */
const selectPlannerVisualAssets = (params: {
  conversation: PersistedConversation;
  uploadedAssets: ImageAsset[];
  explicitReferenceAssetIds: string[];
  inferredReferenceAssetIds: string[];
}) => {
  const byId = new Map(params.conversation.assets.map((asset) => [asset.id, asset]));
  for (const asset of params.uploadedAssets) {
    byId.set(asset.id, asset);
  }

  const picked: ImageAsset[] = [];
  const seen = new Set<string>();
  const add = (asset?: ImageAsset) => {
    if (!asset || seen.has(asset.id)) {
      return;
    }
    if (picked.length >= PLANNER_INLINE_IMAGE_CAP) {
      return;
    }
    // SVG fallback previews aren't useful for visual perception; skip them.
    if (asset.mimeType === "image/svg+xml") {
      return;
    }
    seen.add(asset.id);
    picked.push(asset);
  };

  for (const assetId of params.explicitReferenceAssetIds) {
    add(byId.get(assetId));
  }
  for (const assetId of params.inferredReferenceAssetIds) {
    add(byId.get(assetId));
  }
  for (const asset of params.uploadedAssets) {
    add(asset);
  }

  // If room remains, slot in the most recent generated image as anchor for
  // iteration cases like "再调一下".
  if (picked.length < PLANNER_INLINE_IMAGE_CAP) {
    const latestGenerated = [...params.conversation.assets]
      .reverse()
      .find((asset) => asset.kind === "generated");
    add(latestGenerated);
  }

  return picked;
};

const buildPlannerMultimodalParts = async (params: {
  contextText: string;
  visualAssets: ImageAsset[];
}): Promise<{
  parts: AgentHarnessPart[];
  attachedAssetIds: string[];
  inlineBytes: number;
}> => {
  const parts: AgentHarnessPart[] = [{ text: params.contextText }];
  const attachedAssetIds: string[] = [];

  if (!params.visualAssets.length) {
    return { parts, attachedAssetIds, inlineBytes: 0 };
  }

  let inlineBytes = 0;
  parts.push({
    text:
      "\nVisualEvidence: The following images are the actual pixels of the assets " +
      "mentioned above. Use them to ground intent, choose references, and write " +
      "the English prompt — do not rely on label strings alone.",
  });

  for (const asset of params.visualAssets) {
    try {
      const [reference] = await materializeInlineReferences([asset]);
      if (!reference) {
        continue;
      }
      // Rough byte estimate: base64 expands by ~4/3.
      const approxBytes = Math.floor(reference.base64Data.length * 0.75);
      if (inlineBytes + approxBytes > PLANNER_INLINE_IMAGE_BYTES_CAP) {
        console.warn("[image-agent] planner skipping image (over byte cap)", {
          assetId: asset.id,
          approxBytes,
          alreadyInlined: inlineBytes,
        });
        continue;
      }
      inlineBytes += approxBytes;
      parts.push({
        text: `\n[Image ${asset.id} | ${asset.kind} | label: ${asset.label} | focus: ${asset.focus}]`,
      });
      parts.push({
        inlineData: {
          mimeType: reference.mimeType,
          data: reference.base64Data,
        },
      });
      attachedAssetIds.push(asset.id);
    } catch (error) {
      // Skip images that can't be loaded; downstream still has the text catalog.
      console.warn("[image-agent] planner failed to inline asset", {
        assetId: asset.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { parts, attachedAssetIds, inlineBytes };
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

const normalizeAPlusModuleNumber = (value: string | number) => {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1 || numberValue > 7) {
    return undefined;
  }
  return `0${numberValue}`.slice(-2);
};

const detectAPlusModuleFromText = (text: string) => {
  const match = /(?:module|模块)\s*0?([1-7])\b/i.exec(text);
  return match ? `0${match[1]}`.slice(-2) : undefined;
};

const CHINESE_A_PLUS_NUMBERS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
};

const parseAPlusCountToken = (value: string) =>
  CHINESE_A_PLUS_NUMBERS[value] ?? Number(value);

const pushAPlusModule = (modules: string[], value: string | number) => {
  const moduleId = normalizeAPlusModuleNumber(value);
  if (moduleId && !modules.includes(moduleId)) {
    modules.push(moduleId);
  }
};

const pushAPlusModuleRange = (modules: string[], start: string | number, end: string | number) => {
  const startNumber = typeof start === "number" ? start : Number(start);
  const endNumber = typeof end === "number" ? end : Number(end);
  if (
    !Number.isInteger(startNumber) ||
    !Number.isInteger(endNumber) ||
    startNumber < 1 ||
    startNumber > 7 ||
    endNumber < 1 ||
    endNumber > 7
  ) {
    return;
  }

  const [from, to] =
    startNumber <= endNumber ? [startNumber, endNumber] : [endNumber, startNumber];
  for (let index = from; index <= to; index += 1) {
    pushAPlusModule(modules, index);
  }
};

const detectAPlusModulesFromText = (text: string) => {
  const modules: string[] = [];

  if (
    /(?:整套|全套|全部|所有|每个模块|各个模块|7\s*(?:张|个模块)|七\s*(?:张|个模块))/.test(
      text,
    )
  ) {
    return [...A_PLUS_MODULE_IDS];
  }

  for (const match of text.matchAll(
    /(?:模块|module)?\s*0?([1-7])\s*(?:-|~|到|至|—|–)\s*(?:模块|module)?\s*0?([1-7])/gi,
  )) {
    pushAPlusModuleRange(modules, match[1], match[2]);
  }

  for (const match of text.matchAll(/前\s*([1-7一二三四五六七两])\s*个?\s*模块/g)) {
    const count = parseAPlusCountToken(match[1]);
    if (Number.isInteger(count) && count >= 1 && count <= 7) {
      pushAPlusModuleRange(modules, 1, count);
    }
  }

  for (const match of text.matchAll(
    /(?:模块|module)\s*((?:0?[1-7]\s*(?:[,，、/和及]|and|&|\s)+)*0?[1-7])/gi,
  )) {
    for (const numberMatch of match[1].matchAll(/0?([1-7])/g)) {
      pushAPlusModule(modules, numberMatch[1]);
    }
  }

  for (const match of text.matchAll(/(?:模块|module)\s*0?([1-7])\b/gi)) {
    pushAPlusModule(modules, match[1]);
  }

  return modules;
};

const formatAPlusModuleLabel = (moduleId: string) => `模块${moduleId}`;

const isAPlusRuntimeResource = ({ skill, resource }: SelectedRuntimeResource) =>
  skill.executionMode === "custom" &&
  skill.customWorkflowId === "a-plus" &&
  resource.id.startsWith("a-plus-");

const selectPrimaryAPlusRuntimeResource = (resources: SelectedRuntimeResource[]) => {
  const aPlusResources = resources.filter(isAPlusRuntimeResource);
  return (
    aPlusResources.find(({ resource }) => resource.selectedModules.length > 0) ??
    aPlusResources[0]
  );
};

const wantsAPlusModuleImage = (userText: string) => {
  const lower = userText.toLowerCase();
  if (/(?:prompt|提示词|脚本)/i.test(lower)) {
    return false;
  }
  return /(?:生成.*(?:图|图片)|出图|做图|渲染|render|generate\s+(?:the\s+)?image|create\s+(?:the\s+)?image)/i.test(
    userText,
  );
};

const determineAPlusStage = (params: {
  resource: SelectedRuntimeResource["resource"];
  userText: string;
  activeBrief?: SkillBrief;
}): APlusStage => {
  if (params.resource.id === "a-plus-guidance-template") {
    return "guidance_template";
  }

  const activeStage = skillBriefString(params.activeBrief?.aPlusStage);
  if (activeStage === "module_image" || wantsAPlusModuleImage(params.userText)) {
    return "module_image";
  }

  return "module_prompt";
};

const selectAPlusProductVisualAssets = (params: {
  conversation: PersistedConversation;
  uploadedAssets: ImageAsset[];
  explicitReferenceAssetIds: string[];
  inferredReferenceAssetIds: string[];
}) => {
  const byId = new Map(params.conversation.assets.map((asset) => [asset.id, asset]));
  for (const asset of params.uploadedAssets) {
    byId.set(asset.id, asset);
  }

  const picked: ImageAsset[] = [];
  const seen = new Set<string>();
  const add = (asset?: ImageAsset) => {
    if (!asset || seen.has(asset.id) || asset.mimeType === "image/svg+xml" || picked.length >= 3) {
      return;
    }
    seen.add(asset.id);
    picked.push(asset);
  };

  for (const assetId of params.explicitReferenceAssetIds) {
    add(byId.get(assetId));
  }
  for (const assetId of params.inferredReferenceAssetIds) {
    add(byId.get(assetId));
  }
  for (const asset of params.uploadedAssets) {
    add(asset);
  }

  if (!picked.length) {
    add([...params.conversation.assets].reverse().find((asset) => asset.kind === "upload"));
  }
  if (!picked.length) {
    add([...params.conversation.assets].reverse().find((asset) => asset.kind === "generated"));
  }

  return picked;
};

const A_PLUS_BRIEF_CANDIDATE_LIMIT = 5;
const A_PLUS_BRIEF_CANDIDATE_FIELDS = [
  "productName",
  "sellingPoints",
  "targetCountry",
  "salesPlatform",
] as const;

type APlusBriefCandidateField = (typeof A_PLUS_BRIEF_CANDIDATE_FIELDS)[number];

const normalizeCandidateText = (value: unknown) => {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\s+/g, " ")
    .replace(/^[：:，,、；;\s]+/, "")
    .replace(/[。；;，,、\s]+$/, "")
    .trim()
    .slice(0, 80);
};

const pushAPlusBriefCandidate = (
  candidates: Record<APlusBriefCandidateField, string[]>,
  field: APlusBriefCandidateField,
  value: unknown,
) => {
  const normalized = normalizeCandidateText(value);
  if (!normalized || candidates[field].includes(normalized)) {
    return;
  }
  if (candidates[field].length >= A_PLUS_BRIEF_CANDIDATE_LIMIT) {
    return;
  }
  candidates[field].push(normalized);
};

const splitAPlusCandidateList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => splitAPlusCandidateList(entry));
  }
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/\n|[、,，;；/|]+/)
    .map(normalizeCandidateText)
    .filter(Boolean);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractLabeledAPlusValue = (text: string, labels: string[]) => {
  const labelPattern = labels.map(escapeRegExp).join("|");
  const match = new RegExp(`(?:${labelPattern})\\s*[：:]\\s*([^\\n。；;]+)`, "i").exec(text);
  return normalizeCandidateText(match?.[1]);
};

const detectAPlusCountries = (text: string) => {
  const detections: string[] = [];
  const push = (label: string) => {
    if (!detections.includes(label)) {
      detections.push(label);
    }
  };

  if (/(?:Amazon\s*US|Amazon\.com|美国|US\b|United States|USA)/i.test(text)) {
    push("美国");
  }
  if (/(?:Amazon\s*JP|日本|Japan|JP\b)/i.test(text)) {
    push("日本");
  }
  if (/(?:英国|United Kingdom|UK\b)/i.test(text)) {
    push("英国");
  }
  if (/(?:德国|Germany|DE\b)/i.test(text)) {
    push("德国");
  }
  if (/(?:法国|France|FR\b)/i.test(text)) {
    push("法国");
  }
  if (/(?:欧洲|欧盟|EU\b|Europe)/i.test(text)) {
    push("欧洲");
  }
  if (/(?:加拿大|Canada|CA\b)/i.test(text)) {
    push("加拿大");
  }
  if (/(?:澳大利亚|Australia|AU\b)/i.test(text)) {
    push("澳大利亚");
  }

  return detections;
};

const detectAPlusPlatforms = (text: string) => {
  const detections: string[] = [];
  const push = (label: string) => {
    if (!detections.includes(label)) {
      detections.push(label);
    }
  };

  if (/(?:Amazon\s*US|Amazon\.com|亚马逊美国)/i.test(text)) {
    push("Amazon US");
  } else if (/(?:Amazon\s*JP|亚马逊日本)/i.test(text)) {
    push("Amazon JP");
  } else if (/(?:Amazon|亚马逊)/i.test(text)) {
    push("Amazon");
  }
  if (/(?:Shopify)/i.test(text)) {
    push("Shopify");
  }
  if (/(?:Shopee|虾皮)/i.test(text)) {
    push("Shopee");
  }
  if (/(?:Lazada)/i.test(text)) {
    push("Lazada");
  }
  if (/(?:天猫|Tmall)/i.test(text)) {
    push("天猫");
  }
  if (/(?:淘宝|Taobao)/i.test(text)) {
    push("淘宝");
  }
  if (/(?:京东|JD\.com|JD\b)/i.test(text)) {
    push("京东");
  }

  return detections;
};

const compactAPlusBriefCandidates = (
  candidates: Record<APlusBriefCandidateField, string[]>,
): APlusBriefCandidateValues => {
  const compact: APlusBriefCandidateValues = {};
  for (const field of A_PLUS_BRIEF_CANDIDATE_FIELDS) {
    if (candidates[field].length) {
      compact[field] = candidates[field];
    }
  }
  return compact;
};

const collectAPlusBriefCandidates = (params: {
  conversation: PersistedConversation;
  userText: string;
  uploadedAssets: ImageAsset[];
  explicitReferenceAssetIds: string[];
  inferredReferenceAssetIds: string[];
}): APlusBriefCandidateValues => {
  const candidates: Record<APlusBriefCandidateField, string[]> = {
    productName: [],
    sellingPoints: [],
    targetCountry: [],
    salesPlatform: [],
  };
  const activeBrief = params.conversation.agentState?.creativeBrief;

  pushAPlusBriefCandidate(
    candidates,
    "productName",
    extractLabeledAPlusValue(params.userText, ["产品名称", "产品名", "商品名称", "商品名", "品名"]),
  );
  for (const value of splitAPlusCandidateList(
    extractLabeledAPlusValue(params.userText, [
      "重点突出的卖点",
      "突出卖点",
      "核心卖点",
      "卖点",
      "优势",
      "特点",
    ]),
  )) {
    pushAPlusBriefCandidate(candidates, "sellingPoints", value);
  }
  pushAPlusBriefCandidate(
    candidates,
    "targetCountry",
    extractLabeledAPlusValue(params.userText, [
      "目标国家 / 地区",
      "目标国家",
      "目标地区",
      "国家",
      "地区",
      "市场",
    ]),
  );
  pushAPlusBriefCandidate(
    candidates,
    "salesPlatform",
    extractLabeledAPlusValue(params.userText, ["销售平台", "平台", "渠道"]),
  );

  for (const country of detectAPlusCountries(params.userText)) {
    pushAPlusBriefCandidate(candidates, "targetCountry", country);
  }
  for (const platform of detectAPlusPlatforms(params.userText)) {
    pushAPlusBriefCandidate(candidates, "salesPlatform", platform);
  }

  pushAPlusBriefCandidate(candidates, "productName", activeBrief?.productName);
  for (const value of splitAPlusCandidateList(activeBrief?.sellingPoints)) {
    pushAPlusBriefCandidate(candidates, "sellingPoints", value);
  }
  pushAPlusBriefCandidate(candidates, "targetCountry", activeBrief?.targetCountry);
  pushAPlusBriefCandidate(
    candidates,
    "salesPlatform",
    activeBrief?.salesPlatform ?? activeBrief?.targetChannel,
  );

  const visualAssets = selectAPlusProductVisualAssets({
    conversation: params.conversation,
    uploadedAssets: params.uploadedAssets,
    explicitReferenceAssetIds: params.explicitReferenceAssetIds,
    inferredReferenceAssetIds: params.inferredReferenceAssetIds,
  });
  for (const asset of visualAssets) {
    pushAPlusBriefCandidate(candidates, "productName", asset.observations?.mainSubject);
    pushAPlusBriefCandidate(candidates, "productName", asset.focus);
  }

  return compactAPlusBriefCandidates(candidates);
};

const buildAPlusRuntimeInputText = (params: {
  userText: string;
  stage: APlusStage;
  selectedModule?: string;
  guidanceTemplate?: string;
}) =>
  [
    "Clean A+ runtime task input.",
    "Use only this input and the attached product reference image(s). Do not use any previous conversation context.",
    "",
    `Stage: ${params.stage}`,
    params.selectedModule ? `Selected module: ${params.selectedModule}` : undefined,
    "",
    "User requirement:",
    params.userText || "(empty)",
    params.guidanceTemplate
      ? [
          "",
          "Saved Premium A+ guidance template:",
          params.guidanceTemplate,
        ].join("\n")
      : undefined,
    "",
    "Return only the requested fixed text. Do not explain the process.",
  ]
    .filter(Boolean)
    .join("\n");

const buildAPlusRuntimeParts = async (params: {
  inputText: string;
  visualAssets: ImageAsset[];
}) => {
  const parts: AgentHarnessPart[] = [{ text: params.inputText }];
  const attachedAssetIds: string[] = [];

  for (const asset of params.visualAssets) {
    try {
      const [reference] = await materializeInlineReferences([asset]);
      if (!reference) {
        continue;
      }

      const observation = asset.observations
        ? [
            asset.observations.mainSubject,
            asset.observations.style,
            asset.observations.dominantColors.length
              ? `colors: ${asset.observations.dominantColors.join("/")}`
              : undefined,
            asset.observations.ocrText ? `text: ${asset.observations.ocrText}` : undefined,
          ]
            .filter(Boolean)
            .join("; ")
        : "no saved visual observation";

      parts.push({
        text: `\nProduct reference image ${asset.id} | ${asset.label} | ${observation}`,
      });
      parts.push({
        inlineData: {
          mimeType: reference.mimeType,
          data: reference.base64Data,
        },
      });
      attachedAssetIds.push(asset.id);
    } catch (error) {
      console.warn("[image-agent] A+ runtime failed to inline product image", {
        assetId: asset.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { parts, attachedAssetIds };
};

const buildAPlusRuntimePlannerOutput = (params: {
  text: string;
  stage: APlusStage;
  selectedModule?: string;
  referenceAssetIds: string[];
}): PlannerOutput => {
  const base = {
    selectedSkillId: A_PLUS_SKILL_ID,
    skillConfidence: "high" as const,
    skillBrief: {
      aPlusStage: params.stage,
      ...(params.selectedModule ? { selectedModule: params.selectedModule } : {}),
    },
  };

  if (params.stage === "module_image") {
    if (!params.referenceAssetIds.length) {
      return {
        assistantReply: "我这边还没有能对照的产品图。你先上传一张，或者从前面的图片里选一张，我再做这个模块。",
        nextAction: "clarify",
        ...base,
        shouldGenerate: false,
        needsClarification: true,
        generation: null,
      };
    }

    return {
      assistantReply: params.selectedModule
        ? `模块${params.selectedModule}的画面我已经按产品图安排好了，现在开始生成。`
        : "这个模块的画面已经按产品图安排好了，现在开始生成。",
      nextAction: "reference_generate",
      ...base,
      shouldGenerate: true,
      needsClarification: false,
      generation: {
        mode: "reference_generate",
        prompt: params.text,
        referenceAssetIds: params.referenceAssetIds,
        inheritConversationContext: false,
        outputCount: 1,
        tasks: [
          {
            label: params.selectedModule
              ? `A+ ${formatAPlusModuleLabel(params.selectedModule)}`
              : "A+ 模块图",
            prompt: params.text,
            referenceAssetIds: params.referenceAssetIds,
            inheritConversationContext: false,
            ...(params.selectedModule ? { aPlusModule: params.selectedModule } : {}),
          },
        ],
      },
      internalArtifacts: params.selectedModule
        ? {
            aPlusModulePrompts: {
              [params.selectedModule]: params.text,
            },
          }
        : undefined,
    };
  }

  if (params.stage === "guidance_template") {
    return {
      assistantReply: buildAPlusGuidanceSummaryReply(params.text),
      nextAction: "discuss",
      ...base,
      shouldGenerate: false,
      needsClarification: false,
      generation: null,
      internalArtifacts: {
        aPlusGuidanceTemplate: params.text,
      },
    };
  }

  return {
    assistantReply: params.text,
    nextAction: "discuss",
    ...base,
    shouldGenerate: false,
    needsClarification: false,
    generation: null,
    internalArtifacts: params.selectedModule
      ? {
          aPlusModulePrompts: {
            [params.selectedModule]: params.text,
          },
        }
      : undefined,
  };
};

const buildAPlusBatchRuntimePlannerOutput = (params: {
  stage: APlusStage;
  tasks: PlannedGenerationTask[];
  modulePrompts: Record<string, string>;
}): PlannerOutput => {
  const modules = Object.keys(params.modulePrompts).sort();
  const moduleText = modules.map(formatAPlusModuleLabel).join("、");
  const firstTask = params.tasks[0];
  const base = {
    selectedSkillId: A_PLUS_SKILL_ID,
    skillConfidence: "high" as const,
    skillBrief: {
      aPlusStage: params.stage,
      ...(modules[0] ? { selectedModule: modules[0] } : {}),
      ...(modules.length ? { selectedModules: modules } : {}),
    },
    internalArtifacts: {
      aPlusModulePrompts: params.modulePrompts,
    },
  };

  if (params.stage === "module_image") {
    return {
      assistantReply: `${moduleText}会分别按各自的画面方案生成。它们会共用同一套字体、配色和商品信息，但不会挤进一张含糊的画面里。`,
      nextAction: "reference_generate",
      ...base,
      shouldGenerate: true,
      needsClarification: false,
      generation: {
        mode: "reference_generate",
        prompt: firstTask?.prompt ?? "",
        referenceAssetIds: firstTask?.referenceAssetIds ?? [],
        inheritConversationContext: false,
        outputCount: 1,
        tasks: params.tasks,
      },
    };
  }

  return {
    assistantReply: modules
      .map((moduleId) => `### ${formatAPlusModuleLabel(moduleId)}\n\n${params.modulePrompts[moduleId]}`)
      .join("\n\n"),
    nextAction: "discuss",
    ...base,
    shouldGenerate: false,
    needsClarification: false,
    generation: null,
  };
};

const buildAPlusBriefFormPlannerOutput = (
  params?: {
    conversation: PersistedConversation;
    userText: string;
    uploadedAssets: ImageAsset[];
    explicitReferenceAssetIds: string[];
    inferredReferenceAssetIds: string[];
  },
): PlannerOutput => {
  const candidates = params ? collectAPlusBriefCandidates(params) : {};

  return {
    assistantReply:
      "做这套 A+ 图之前，我先把 7 个模块共用的视觉方案定下来。下面的信息都是选填的；产品名、重点卖点、目标地区和销售平台，手头有多少就填多少，没有的我会先根据产品图和上下文判断。",
    nextAction: "clarify",
    selectedSkillId: A_PLUS_SKILL_ID,
    skillConfidence: "high",
    skillBrief: {
      shotType: "A+ 套图",
      aPlusStage: A_PLUS_BRIEF_STAGE,
      aPlusBriefCollected: false,
      ...(candidates.productName?.length ? { productNameCandidates: candidates.productName } : {}),
      ...(candidates.sellingPoints?.length
        ? { sellingPointCandidates: candidates.sellingPoints }
        : {}),
      ...(candidates.targetCountry?.length
        ? { targetCountryCandidates: candidates.targetCountry }
        : {}),
      ...(candidates.salesPlatform?.length
        ? { salesPlatformCandidates: candidates.salesPlatform }
        : {}),
    },
    shouldGenerate: false,
    needsClarification: true,
    generation: null,
  };
};

const hasCollectedAPlusBrief = (params: {
  conversation: PersistedConversation;
  userText: string;
}) =>
  isAPlusBriefSubmissionText(params.userText) ||
  params.conversation.agentState?.creativeBrief?.aPlusBriefCollected === true;

const buildMissingAPlusGuidanceOutput = (selectedModule?: string): PlannerOutput => ({
  assistantReply: selectedModule
    ? `模块${selectedModule}还缺前面那套电商图方案。你先上传或选中产品图，把整体方案定下来；如果已经有确认过的方案，直接把内容发给我也可以。`
    : "这些 A+ 模块还缺一套统一的电商图方案。你先上传或选中产品图，把整体方向定下来；如果已经有确认过的方案，直接把内容发给我也可以。",
  nextAction: "clarify",
  selectedSkillId: A_PLUS_SKILL_ID,
  skillConfidence: "high",
  skillBrief: {
    aPlusStage: "guidance_template",
    ...(selectedModule ? { selectedModule } : {}),
  },
  shouldGenerate: false,
  needsClarification: true,
  generation: null,
});

const repairPlannerOutput = (output: PlannerOutput): PlannerOutput => {
  if (!output.generation || !output.shouldGenerate) {
    return {
      ...output,
      shouldGenerate: false,
      needsClarification: output.nextAction === "clarify",
      generation: null,
    };
  }

  const generation = output.generation;

  // Edit needs a real image to act on. The LLM saw the full asset catalog (ids,
  // labels, focus, observations, source requests) plus the actual pixels of the
  // recent images, and chose `referenceAssetIds` itself. Those IDs were already
  // validated against real assets in `normalizePlannerOutput`, so a non-empty
  // list IS the proof that a concrete target exists. We do NOT second-guess that
  // choice with text keyword matching. The only failure we still repair is an
  // edit that resolved to ZERO valid references — there's nothing to edit, so we
  // ask the user to point at an image instead of generating blindly.
  if (generation.mode === "edit" && generation.referenceAssetIds.length === 0) {
    logPlannerRepair("edit_without_valid_reference", {
      referenceAssetIds: generation.referenceAssetIds,
    });

    return {
      assistantReply: buildMissingEditReferenceReply(),
      reasoningSummary: output.reasoningSummary,
      nextAction: "clarify",
      selectedSkillId: output.selectedSkillId,
      skillConfidence: output.skillConfidence,
      skillBrief: output.skillBrief,
      memoryUpdate: output.memoryUpdate,
      shouldGenerate: false,
      needsClarification: true,
      generation: null,
    };
  }

  return {
    ...output,
    nextAction: generation.mode,
    shouldGenerate: true,
    needsClarification: false,
  };
};

const sanitizeSkillBriefValue = (value: unknown): SkillBriefValue | undefined => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const stringValues = value.filter((entry): entry is string => typeof entry === "string");
    return stringValues.length ? stringValues.slice(0, 8) : undefined;
  }

  return undefined;
};

const sanitizeSkillBrief = (value: unknown): SkillBrief | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const brief: SkillBrief = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const safeValue = sanitizeSkillBriefValue(rawValue);
    if (safeValue !== undefined) {
      brief[key] = safeValue;
    }
  }

  return Object.keys(brief).length ? brief : undefined;
};

const sanitizeMemoryStringList = (value: unknown) =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter(
              (entry): entry is string =>
                typeof entry === "string" && entry.trim().length > 0,
            )
            .map((entry) => entry.replace(/\s+/g, " ").trim().slice(0, 160)),
        ),
      ).slice(0, 12)
    : undefined;

const sanitizePlannerMemoryUpdate = (value: unknown): PlannerOutput["memoryUpdate"] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const conversationSummary =
    typeof raw.conversationSummary === "string" && raw.conversationSummary.trim()
      ? raw.conversationSummary.replace(/\s+/g, " ").trim().slice(0, 1_600)
      : undefined;
  const learnedUserPreferences = sanitizeMemoryStringList(raw.learnedUserPreferences);
  const removedUserPreferences = sanitizeMemoryStringList(raw.removedUserPreferences);

  if (!conversationSummary && !learnedUserPreferences?.length && !removedUserPreferences?.length) {
    return undefined;
  }

  return {
    conversationSummary,
    learnedUserPreferences,
    removedUserPreferences,
  };
};

const sanitizeTaskText = (value: unknown, maxLength: number) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : undefined;

const normalizePlannerGenerationTasks = (params: {
  rawTasks: unknown;
  validReferenceIds: Set<string>;
  fallbackReferenceAssetIds: string[];
  fallbackInheritConversationContext: boolean;
}): PlannedGenerationTask[] | undefined => {
  if (!Array.isArray(params.rawTasks)) {
    return undefined;
  }

  const tasks: PlannedGenerationTask[] = [];
  for (const rawTask of params.rawTasks) {
    if (!rawTask || typeof rawTask !== "object" || Array.isArray(rawTask)) {
      continue;
    }

    const taskObject = rawTask as Record<string, unknown>;
    const prompt = sanitizeTaskText(taskObject.prompt, 6_000);
    if (!prompt) {
      continue;
    }

    const rawReferenceAssetIds = Array.isArray(taskObject.referenceAssetIds)
      ? taskObject.referenceAssetIds
          .filter((id): id is string => typeof id === "string" && params.validReferenceIds.has(id))
          .slice(0, 3)
      : [];
    const aPlusModule = normalizeAPlusModule(taskObject.aPlusModule);

    tasks.push({
      label: sanitizeTaskText(taskObject.label, 80),
      prompt,
      referenceAssetIds: rawReferenceAssetIds.length
        ? rawReferenceAssetIds
        : params.fallbackReferenceAssetIds,
      inheritConversationContext:
        typeof taskObject.inheritConversationContext === "boolean"
          ? taskObject.inheritConversationContext
          : params.fallbackInheritConversationContext,
      ...(aPlusModule ? { aPlusModule } : {}),
    });
  }

  return tasks.length > 1 ? tasks.slice(0, 12) : undefined;
};

const normalizePlannerOutput = (
  candidate: unknown,
  fallback: PlannerOutput,
  validReferenceIds: Set<string>,
  validSkillIds: Set<string> = new Set(),
): PlannerOutput => {
  if (!candidate || typeof candidate !== "object") {
    return fallback;
  }

  const raw = candidate as Record<string, unknown>;
  const action = raw.nextAction;
  const nextAction = plannerActions.has(action as PlannerAction)
    ? (action as PlannerAction)
    : fallback.nextAction;
  const isGenerativeAction = generationActions.has(nextAction as GenerationAction);
  const shouldGenerate = isGenerativeAction
    ? typeof raw.shouldGenerate === "boolean"
      ? raw.shouldGenerate
      : fallback.shouldGenerate
    : false;
  const needsClarification =
    nextAction === "clarify" && typeof raw.needsClarification === "boolean"
      ? raw.needsClarification
      : nextAction === "clarify";
  const assistantReply =
    typeof raw.assistantReply === "string" && raw.assistantReply.trim()
      ? raw.assistantReply.trim()
      : fallback.assistantReply;
  const reasoningSummary =
    typeof raw.reasoningSummary === "string" && raw.reasoningSummary.trim()
      ? raw.reasoningSummary.replace(/\s+/g, " ").trim().slice(0, 500)
      : fallback.reasoningSummary;
  const selectedSkillId =
    typeof raw.selectedSkillId === "string" && validSkillIds.has(raw.selectedSkillId)
      ? raw.selectedSkillId
      : fallback.selectedSkillId && validSkillIds.has(fallback.selectedSkillId)
        ? fallback.selectedSkillId
        : undefined;
  const skillConfidence =
    selectedSkillId &&
    typeof raw.skillConfidence === "string" &&
    skillConfidenceValues.has(raw.skillConfidence as SkillConfidence)
      ? (raw.skillConfidence as SkillConfidence)
      : selectedSkillId
        ? fallback.skillConfidence
        : undefined;
  const skillBrief = selectedSkillId
    ? sanitizeSkillBrief(raw.skillBrief) ?? fallback.skillBrief
    : undefined;
  const memoryUpdate =
    sanitizePlannerMemoryUpdate(raw.memoryUpdate) ?? fallback.memoryUpdate;

  const rawGeneration = raw.generation;

  if (
    !shouldGenerate ||
    nextAction === "discuss" ||
    nextAction === "clarify" ||
    !rawGeneration ||
    typeof rawGeneration !== "object"
  ) {
    return {
      assistantReply,
      reasoningSummary,
      nextAction,
      selectedSkillId,
      skillConfidence,
      skillBrief,
      memoryUpdate,
      shouldGenerate: false,
      needsClarification: nextAction === "clarify",
      generation: null,
    };
  }

  const generationObject = rawGeneration as Record<string, unknown>;
  const safeMode = nextAction as GenerationAction;
  const prompt =
    typeof generationObject.prompt === "string" && generationObject.prompt.trim()
      ? generationObject.prompt.trim()
      : fallback.generation?.prompt ?? fallback.assistantReply;
  const rawReferenceAssetIds = Array.isArray(generationObject.referenceAssetIds)
    ? generationObject.referenceAssetIds
        .filter((id): id is string => typeof id === "string" && validReferenceIds.has(id))
        .slice(0, 3)
    : [];
  const fallbackReferenceAssetIds =
    fallback.generation?.mode === safeMode
      ? fallback.generation.referenceAssetIds
          .filter((id) => validReferenceIds.has(id))
          .slice(0, 3)
      : [];
  const referenceAssetIds = rawReferenceAssetIds.length
    ? rawReferenceAssetIds
    : fallbackReferenceAssetIds;
  const inheritConversationContext =
    typeof generationObject.inheritConversationContext === "boolean"
      ? generationObject.inheritConversationContext
      : fallback.generation?.inheritConversationContext ?? true;
  const outputCount =
    typeof generationObject.outputCount === "number" &&
    Number.isFinite(generationObject.outputCount) &&
    generationObject.outputCount > 0
      ? Math.max(1, Math.round(generationObject.outputCount))
      : fallback.generation?.outputCount ?? 1;
  const tasks =
    normalizePlannerGenerationTasks({
      rawTasks: generationObject.tasks,
      validReferenceIds,
      fallbackReferenceAssetIds: referenceAssetIds,
      fallbackInheritConversationContext: inheritConversationContext,
    }) ?? fallback.generation?.tasks;

  return {
    assistantReply,
    reasoningSummary,
    nextAction,
    selectedSkillId,
    skillConfidence,
    skillBrief,
    memoryUpdate,
    shouldGenerate: true,
    needsClarification,
    generation: {
      mode: safeMode,
      prompt,
      referenceAssetIds,
      inheritConversationContext,
      outputCount,
      ...(tasks?.length ? { tasks } : {}),
    },
  };
};

// When the LLM is offline (no provider configured, or the call failed), we do
// NOT try to route the turn with keyword heuristics — a regex can't read intent
// reliably, and emitting a wrong action or a wrong image is worse than honestly
// saying we're unavailable. Tell the user plainly and generate nothing.
const buildOfflineUnavailableOutput = (): PlannerOutput => ({
  assistantReply: IMAGE_AGENT_PROMPTS.fallbackAssistantReplies.offlineUnavailable,
  nextAction: "clarify",
  shouldGenerate: false,
  needsClarification: true,
  generation: null,
});

// Neutral default fed to normalizePlannerOutput as the value source when a field
// is missing/invalid in the raw LLM JSON. It is intentionally inert (no
// generation, no action bias) so a malformed field degrades to "ask again",
// never to a fabricated generate/edit.
const buildNeutralPlannerDefault = (): PlannerOutput => ({
  assistantReply: IMAGE_AGENT_PROMPTS.fallbackAssistantReplies.offlineUnavailable,
  nextAction: "clarify",
  shouldGenerate: false,
  needsClarification: true,
  generation: null,
});

const resolvePlannerAgentRuntime = (params: {
  agentProviderId?: string;
  agentModelId?: string;
  selectedRuntimeResources: SelectedRuntimeResource[];
}) => {
  const preferredRuntimeResource = params.selectedRuntimeResources.find(
    ({ skill, resource }) =>
      skill.executionMode === "custom" &&
      (resource.preferredAgentProviderId || resource.preferredAgentModelId),
  );

  if (!preferredRuntimeResource) {
    return {
      ...(params.agentProviderId || params.agentModelId
        ? resolveAgentHarnessRuntime({
            providerId: params.agentProviderId,
            modelId: params.agentModelId,
          })
        : getConfiguredAgentHarnessRuntime()),
      preferredRuntimeResource: undefined,
    };
  }

  const { resource } = preferredRuntimeResource;

  return {
    ...resolveAgentHarnessRuntime({
      providerId:
        resource.preferredAgentProviderId ??
        (resource.preferredAgentModelId ? undefined : params.agentProviderId),
      modelId: resource.preferredAgentModelId ?? params.agentModelId,
    }),
    preferredRuntimeResource,
  };
};

const planSingleCleanAPlusRuntime = async (params: {
  conversation: PersistedConversation;
  userText: string;
  uploadedAssets: ImageAsset[];
  explicitReferenceAssetIds: string[];
  inferredReferenceAssetIds: string[];
  runtimeResource: SelectedRuntimeResource;
  model: string;
}) => {
  const activeBrief = params.conversation.agentState?.creativeBrief;
  const requestedModules = params.runtimeResource.resource.selectedModules.length
    ? detectAPlusModulesFromText(params.userText)
    : [];
  const selectedModule =
    params.runtimeResource.resource.selectedModules[0] ??
    requestedModules[0] ??
    detectAPlusModuleFromText(params.userText) ??
    normalizeAPlusModule(activeBrief?.selectedModule);
  const stage = determineAPlusStage({
    resource: params.runtimeResource.resource,
    userText: params.userText,
    activeBrief,
  });
  const savedGuidance =
    params.conversation.agentState?.aPlusArtifacts?.guidanceTemplate?.text;
  const savedModulePrompt = selectedModule
    ? params.conversation.agentState?.aPlusArtifacts?.modulePrompts?.[selectedModule]?.text
    : undefined;
  const visualAssets = selectAPlusProductVisualAssets({
    conversation: params.conversation,
    uploadedAssets: params.uploadedAssets,
    explicitReferenceAssetIds: params.explicitReferenceAssetIds,
    inferredReferenceAssetIds: params.inferredReferenceAssetIds,
  });

  if (stage === "module_image" && savedModulePrompt) {
    const referenceAssetIds = visualAssets.map((asset) => asset.id);
    console.warn("[image-agent] A+ runtime using saved module prompt", {
      module: selectedModule,
      references: referenceAssetIds,
    });
    return buildAPlusRuntimePlannerOutput({
      text: savedModulePrompt,
      stage,
      selectedModule,
      referenceAssetIds,
    });
  }

  if (stage !== "guidance_template" && !savedGuidance) {
    return buildMissingAPlusGuidanceOutput(selectedModule);
  }

  const inputText = buildAPlusRuntimeInputText({
    userText: params.userText,
    stage,
    selectedModule,
    guidanceTemplate: stage === "guidance_template" ? undefined : savedGuidance,
  });
  const { parts, attachedAssetIds } = await buildAPlusRuntimeParts({
    inputText,
    visualAssets,
  });

  console.warn("[image-agent] planner running clean A+ runtime", {
    model: params.model,
    resource: `${params.runtimeResource.skill.id}/${params.runtimeResource.resource.id}`,
    stage,
    selectedModule,
    productImages: attachedAssetIds,
    includesSavedGuidance: Boolean(stage !== "guidance_template" && savedGuidance),
  });

  const result = await generateTextWithGemini({
    model: params.model,
    systemInstruction: params.runtimeResource.resource.content,
    parts,
  });

  if (result.usage) {
    console.warn("[image-agent] clean A+ runtime token usage", {
      model: params.model,
      prompt: result.usage.promptTokenCount,
      output: result.usage.candidatesTokenCount,
    });
  }

  return buildAPlusRuntimePlannerOutput({
    text: result.text,
    stage,
    selectedModule,
    referenceAssetIds: attachedAssetIds,
  });
};

const planWithCleanAPlusRuntime = async (params: {
  conversation: PersistedConversation;
  userText: string;
  uploadedAssets: ImageAsset[];
  explicitReferenceAssetIds: string[];
  inferredReferenceAssetIds: string[];
  runtimeResource: SelectedRuntimeResource;
  runtimeResources?: SelectedRuntimeResource[];
  model: string;
}) => {
  const runtimeResources =
    params.runtimeResources?.filter(isAPlusRuntimeResource).length
      ? params.runtimeResources.filter(isAPlusRuntimeResource)
      : [params.runtimeResource];
  const moduleResources = runtimeResources.filter(
    ({ resource }) => resource.selectedModules.length > 0,
  );

  if (runtimeResources.length === 1 || moduleResources.length <= 1) {
    return planSingleCleanAPlusRuntime({
      conversation: params.conversation,
      userText: params.userText,
      uploadedAssets: params.uploadedAssets,
      explicitReferenceAssetIds: params.explicitReferenceAssetIds,
      inferredReferenceAssetIds: params.inferredReferenceAssetIds,
      runtimeResource: runtimeResources[0],
      model: params.model,
    });
  }

  const outputs: PlannerOutput[] = [];
  for (const runtimeResource of moduleResources) {
    const output = await planSingleCleanAPlusRuntime({
      conversation: params.conversation,
      userText: params.userText,
      uploadedAssets: params.uploadedAssets,
      explicitReferenceAssetIds: params.explicitReferenceAssetIds,
      inferredReferenceAssetIds: params.inferredReferenceAssetIds,
      runtimeResource,
      model: params.model,
    });

    if (output.nextAction === "clarify" || output.needsClarification) {
      return output;
    }

    outputs.push(output);
  }

  const stage = outputs.some((output) => output.generation?.tasks?.length)
    ? "module_image"
    : "module_prompt";
  const modulePrompts: Record<string, string> = {};
  const tasks: PlannedGenerationTask[] = [];

  for (const output of outputs) {
    for (const [moduleId, prompt] of Object.entries(
      output.internalArtifacts?.aPlusModulePrompts ?? {},
    )) {
      modulePrompts[moduleId] = prompt;
    }

    const outputTasks = output.generation?.tasks?.length
      ? output.generation.tasks
      : output.generation
        ? [
            {
              label: output.skillBrief?.selectedModule
                ? `A+ ${formatAPlusModuleLabel(String(output.skillBrief.selectedModule))}`
                : "A+ 模块图",
              prompt: output.generation.prompt,
              referenceAssetIds: output.generation.referenceAssetIds,
              inheritConversationContext: output.generation.inheritConversationContext,
              ...(typeof output.skillBrief?.selectedModule === "string"
                ? { aPlusModule: output.skillBrief.selectedModule }
                : {}),
            },
          ]
        : [];

    tasks.push(...outputTasks);
  }

  return buildAPlusBatchRuntimePlannerOutput({
    stage,
    tasks,
    modulePrompts,
  });
};

export async function planNextStep(params: {
  conversation: PersistedConversation;
  userText: string;
  uploadedAssets: ImageAsset[];
  explicitReferenceAssetIds: string[];
  inferredReferenceAssetIds: string[];
  userPreferences?: string[];
  agentProviderId?: string;
  agentModelId?: string;
  onReasoningDelta?: (delta: string) => void;
}) {
  const validReferenceIds = new Set(params.conversation.assets.map((asset) => asset.id));

  for (const asset of params.uploadedAssets) {
    validReferenceIds.add(asset.id);
  }

  const neutralDefault = buildNeutralPlannerDefault();

  try {
    const candidateSkills = await selectCandidateSkills({
      userText: params.userText,
      activeSkillId: params.conversation.agentState?.activeSkillId,
      limit: 3,
    });
    const selectedRuntimeResources = selectRuntimeResourcesForPlanner({
      candidateSkills,
      agentState: params.conversation.agentState,
      userText: params.userText,
    });
    const agentRuntime = resolvePlannerAgentRuntime({
      agentProviderId: params.agentProviderId,
      agentModelId: params.agentModelId,
      selectedRuntimeResources,
    });
    const agentConfigured = agentRuntime.adapter.isConfigured();
    const runWithPublicReasoning = async <T>(task: () => Promise<T> | T): Promise<T> => {
      const publicReasoningPromise: Promise<void> =
        params.onReasoningDelta && agentConfigured
          ? agentRuntime.adapter
              .streamPublicReasoning({
                model: agentRuntime.model,
                prompt: buildPublicReasoningNarrationPrompt({
                  ...params,
                  candidateSkills,
                }),
                onDelta: params.onReasoningDelta,
              })
              .then(() => undefined)
              .catch((error) => {
                console.warn("[image-agent] public reasoning narration unavailable", {
                  provider: agentRuntime.provider.id,
                  error: error instanceof Error ? error.message : String(error),
                });
              })
          : Promise.resolve();
      const taskPromise = Promise.resolve().then(task);
      const [result] = await Promise.all([taskPromise, publicReasoningPromise]);
      return result;
    };

    const model = agentRuntime.model.providerModel;
    const primaryAPlusRuntimeResource =
      selectPrimaryAPlusRuntimeResource(selectedRuntimeResources);
    const aPlusRuntimeResources = selectedRuntimeResources.filter(isAPlusRuntimeResource);

    if (primaryAPlusRuntimeResource && agentRuntime.preferredRuntimeResource) {
      if (
        primaryAPlusRuntimeResource.resource.id === "a-plus-guidance-template" &&
        !hasCollectedAPlusBrief({
          conversation: params.conversation,
          userText: params.userText,
        })
      ) {
        return runWithPublicReasoning(() =>
          buildAPlusBriefFormPlannerOutput({
            conversation: params.conversation,
            userText: params.userText,
            uploadedAssets: params.uploadedAssets,
            explicitReferenceAssetIds: params.explicitReferenceAssetIds,
            inferredReferenceAssetIds: params.inferredReferenceAssetIds,
          }),
        );
      }

      return runWithPublicReasoning(() =>
        planWithCleanAPlusRuntime({
          conversation: params.conversation,
          userText: params.userText,
          uploadedAssets: params.uploadedAssets,
          explicitReferenceAssetIds: params.explicitReferenceAssetIds,
          inferredReferenceAssetIds: params.inferredReferenceAssetIds,
          runtimeResource: primaryAPlusRuntimeResource,
          runtimeResources: aPlusRuntimeResources,
          model,
        }),
      );
    }

    if (!agentConfigured) {
      console.warn("[image-agent] planner offline: no agent provider configured", {
        provider: agentRuntime.provider.id,
        model: agentRuntime.model.providerModel,
      });
      return buildOfflineUnavailableOutput();
    }

    const systemText = await loadImageAgentSystemPrompt();
    const contextText = buildPlannerContextText({
      ...params,
      candidateSkills,
    });
    const validSkillIds = new Set(candidateSkills.map((skill) => skill.id));

    if (agentRuntime.preferredRuntimeResource) {
      console.warn("[image-agent] planner using skill preferred agent model", {
        provider: agentRuntime.provider.id,
        model,
        resource: `${agentRuntime.preferredRuntimeResource.skill.id}/${agentRuntime.preferredRuntimeResource.resource.id}`,
      });
    }

    const multimodal = agentRuntime.model.capabilities.vision
      ? await buildPlannerMultimodalParts({
          contextText,
          visualAssets: selectPlannerVisualAssets(params),
        })
      : undefined;

    if (multimodal?.attachedAssetIds.length) {
      console.warn("[image-agent] harness attached visual evidence", {
        provider: agentRuntime.provider.id,
        count: multimodal.attachedAssetIds.length,
        assets: multimodal.attachedAssetIds,
        inlineBytes: multimodal.inlineBytes,
      });
    } else {
      console.warn("[image-agent] harness running with normalized text context", {
        provider: agentRuntime.provider.id,
        model,
        vision: agentRuntime.model.capabilities.vision,
        uploads: params.uploadedAssets.length,
        explicit: params.explicitReferenceAssetIds.length,
        inferred: params.inferredReferenceAssetIds.length,
      });
    }

    const result = await runWithPublicReasoning(() =>
      agentRuntime.adapter.generateStructuredJson<PlannerOutput>({
        model: agentRuntime.model,
        prompt: contextText,
        parts: multimodal?.parts,
        jsonSchema: plannerSchema,
        systemInstruction: systemText,
        // Keep the provider's structured planner on its streaming/medium-reasoning
        // path for latency, but never surface its private reasoning channel.
        onReasoningDelta: params.onReasoningDelta ? () => undefined : undefined,
      }),
    );

    if (result.usage) {
      console.warn("[image-agent] planner token usage", {
        provider: agentRuntime.provider.id,
        model,
        prompt: result.usage.inputTokens,
        cached: result.usage.cachedInputTokens,
        output: result.usage.outputTokens,
      });
    }

    return repairPlannerOutput(
      normalizePlannerOutput(result.data, neutralDefault, validReferenceIds, validSkillIds),
    );
  } catch (error) {
    console.warn("[image-agent] planner LLM failed; returning offline notice", {
      error: error instanceof Error ? error.message : String(error),
    });
    return buildOfflineUnavailableOutput();
  }
}

export const __plannerTestHooks = {
  normalizePlannerOutput,
  repairPlannerOutput,
  buildOfflineUnavailableOutput,
  buildPlannerContextText,
  sanitizeSkillBrief,
  resolvePlannerAgentRuntime,
  buildAPlusRuntimeInputText,
  buildAPlusRuntimePlannerOutput,
  buildAPlusBriefFormPlannerOutput,
  selectPrimaryAPlusRuntimeResource,
  planWithCleanAPlusRuntime,
};
