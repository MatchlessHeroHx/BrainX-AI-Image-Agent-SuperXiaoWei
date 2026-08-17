import {
  formatPromptTemplate,
  IMAGE_AGENT_PROMPTS,
} from "@/lib/agent/prompt-config";
import type { PersistedConversation } from "@/lib/types";

const CONVERSATION_CONTEXT_PROMPTS = IMAGE_AGENT_PROMPTS.conversationContext;
const FALLBACK_TITLE = CONVERSATION_CONTEXT_PROMPTS.fallbackTitle;

const truncate = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;

const sortByCreatedAt = (a: { createdAt: string }, b: { createdAt: string }) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

const formatAsQuotedList = (items: string[]) =>
  items.map((item) => `“${item}”`).join("、");

const isDefaultConversationTitle = (title: string) =>
  !title.trim() || /^新会话(?:\s+\d{2}:\d{2})?$/.test(title.trim());

const latestItems = <T>(items: T[], count: number) => items.slice(-count);

export type ConversationContextOptions = {
  userText?: string;
  requiredAssetIds?: string[];
  userPreferences?: string[];
  assetLimit?: number;
};

export const listGeneratedAssets = (conversation: PersistedConversation) =>
  conversation.assets.filter((asset) => asset.kind === "generated").sort(sortByCreatedAt);

export const listUploadedAssets = (conversation: PersistedConversation) =>
  conversation.assets.filter((asset) => asset.kind === "upload").sort(sortByCreatedAt);

const getMessageById = (conversation: PersistedConversation, messageId?: string) =>
  messageId ? conversation.messages.find((message) => message.id === messageId) : undefined;

const getAssetById = (conversation: PersistedConversation, assetId?: string) =>
  assetId ? conversation.assets.find((asset) => asset.id === assetId) : undefined;

const inferConversationTitle = (conversation: PersistedConversation) => {
  if (!isDefaultConversationTitle(conversation.title)) {
    return conversation.title;
  }

  const firstUserMessage = conversation.messages.find(
    (message) => message.role === "user" && message.text.trim(),
  );

  if (!firstUserMessage) {
    return FALLBACK_TITLE;
  }

  return truncate(firstUserMessage.text.trim().replace(/\s+/g, " "), 18);
};

const buildSubtitle = (conversation: PersistedConversation) => {
  const generatedAssets = listGeneratedAssets(conversation);
  const uploadedAssets = listUploadedAssets(conversation);
  const latestGenerated = generatedAssets.at(-1);
  const latestUserMessage = [...conversation.messages]
    .reverse()
    .find((message) => message.role === "user" && message.text.trim());

  if (latestGenerated) {
    return formatPromptTemplate(CONVERSATION_CONTEXT_PROMPTS.subtitleWithGeneratedTemplate, {
      generatedCount: generatedAssets.length,
    });
  }

  if (uploadedAssets.length) {
    return formatPromptTemplate(CONVERSATION_CONTEXT_PROMPTS.subtitleWithUploadsTemplate, {
      uploadedCount: uploadedAssets.length,
    });
  }

  if (latestUserMessage) {
    return CONVERSATION_CONTEXT_PROMPTS.subtitleWithLatestUser;
  }

  return CONVERSATION_CONTEXT_PROMPTS.subtitleEmpty;
};

const buildCarryHint = (conversation: PersistedConversation) => {
  const generatedAssets = listGeneratedAssets(conversation);
  const uploadedAssets = listUploadedAssets(conversation);
  const latestGenerated = generatedAssets.at(-1);
  const latestUserMessage = [...conversation.messages]
    .reverse()
    .find((message) => message.role === "user" && message.text.trim());

  if (latestGenerated) {
    const parentAsset = getAssetById(conversation, latestGenerated.derivedFromAssetId);
    const sourceMessage = getMessageById(conversation, latestGenerated.sourceMessageId);
    const focusParts = [
      formatPromptTemplate(CONVERSATION_CONTEXT_PROMPTS.carryLatestGeneratedCurrentTemplate, {
        label: latestGenerated.label,
      }),
      parentAsset
        ? formatPromptTemplate(CONVERSATION_CONTEXT_PROMPTS.carryLatestGeneratedParentTemplate, {
            label: parentAsset.label,
          })
        : null,
      sourceMessage?.text
        ? formatPromptTemplate(CONVERSATION_CONTEXT_PROMPTS.carryLatestGeneratedSourceTemplate, {
            text: truncate(sourceMessage.text, 46),
          })
        : null,
      latestUserMessage?.text
        ? formatPromptTemplate(CONVERSATION_CONTEXT_PROMPTS.carryLatestGeneratedUserTemplate, {
            text: truncate(latestUserMessage.text, 42),
          })
        : null,
    ].filter(Boolean);

    return focusParts.join(" ");
  }

  const latestUpload = uploadedAssets.at(-1);

  if (latestUpload) {
    return formatPromptTemplate(CONVERSATION_CONTEXT_PROMPTS.carryLatestUploadTemplate, {
      label: latestUpload.label,
    });
  }

  if (latestUserMessage) {
    return CONVERSATION_CONTEXT_PROMPTS.carryLatestUser;
  }

  return CONVERSATION_CONTEXT_PROMPTS.carryEmpty;
};

const buildPreferenceSummary = (
  conversation: PersistedConversation,
  durablePreferences: string[] = [],
) => {
  const normalizedPreferences = Array.from(
    new Set(
      durablePreferences.map((preference) => preference.trim()).filter(Boolean),
    ),
  ).slice(0, 24);
  const recentUserRequests = latestItems(
    conversation.messages.filter((message) => message.role === "user" && message.text.trim()),
    3,
  );

  if (!normalizedPreferences.length && !recentUserRequests.length) {
    return CONVERSATION_CONTEXT_PROMPTS.preferenceEmpty;
  }

  return [
    normalizedPreferences.length
      ? [
          "Durable cross-conversation preferences:",
          ...normalizedPreferences.map((preference) => `- ${truncate(preference, 160)}`),
        ].join("\n")
      : "Durable cross-conversation preferences: none",
    recentUserRequests.length
      ? [
          "Recent user requirements (not automatically durable preferences):",
          ...recentUserRequests.map(
            (message, index) => `${index + 1}. ${truncate(message.text.trim(), 120)}`,
          ),
        ].join("\n")
      : "Recent user requirements: none",
  ].join("\n");
};

const buildVisualTimeline = (
  conversation: PersistedConversation,
  includedAssetIds?: Set<string>,
) => {
  const generatedAssets = listGeneratedAssets(conversation);

  if (!generatedAssets.length) {
    return CONVERSATION_CONTEXT_PROMPTS.visualTimelineEmpty;
  }

  return generatedAssets
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => !includedAssetIds || includedAssetIds.has(asset.id))
    .map(({ asset, index }) => {
      const parentAsset = getAssetById(conversation, asset.derivedFromAssetId);
      const sourceMessage = getMessageById(conversation, asset.sourceMessageId);
      const parts = [
        `第${index + 1}张`,
        asset.id,
        asset.label,
        asset.focus ? `focus: ${truncate(asset.focus, 72)}` : null,
        parentAsset ? `derivedFrom: ${parentAsset.label}` : null,
        sourceMessage?.text ? `sourceRequest: ${truncate(sourceMessage.text, 72)}` : null,
      ].filter(Boolean);

      return `- ${parts.join(" | ")}`;
    })
    .join("\n");
};

const normalizeRelevanceText = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, " ");

const relevanceTokens = (value: string) => {
  const normalized = normalizeRelevanceText(value);
  const tokens = new Set<string>();

  for (const match of normalized.matchAll(/[a-z0-9+][a-z0-9+_-]+|[\u3400-\u9fff]+/g)) {
    const token = match[0];
    if (/^[\u3400-\u9fff]+$/.test(token)) {
      if (token.length <= 4) {
        tokens.add(token);
      }
      for (let size = 2; size <= Math.min(4, token.length); size += 1) {
        for (let index = 0; index <= token.length - size; index += 1) {
          tokens.add(token.slice(index, index + size));
        }
      }
    } else if (token.length >= 2) {
      tokens.add(token);
    }
  }

  return tokens;
};

const assetSearchText = (conversation: PersistedConversation, assetId: string) => {
  const asset = getAssetById(conversation, assetId);
  if (!asset) {
    return "";
  }
  const sourceMessage = getMessageById(conversation, asset.sourceMessageId);
  return [
    asset.id,
    asset.label,
    asset.focus,
    asset.semanticSummary?.summary,
    asset.semanticSummary?.subject,
    asset.semanticSummary?.style,
    asset.semanticSummary?.palette?.join(" "),
    asset.semanticSummary?.composition,
    asset.semanticSummary?.referenceDimensions.join(" "),
    asset.semanticSummary?.editableRegions.join(" "),
    asset.observations?.mainSubject,
    asset.observations?.style,
    asset.observations?.dominantColors.join(" "),
    asset.observations?.ocrText,
    sourceMessage?.text,
  ]
    .filter(Boolean)
    .join(" ");
};

export const selectRelevantAssetsForContext = (
  conversation: PersistedConversation,
  options: ConversationContextOptions = {},
) => {
  const sortedAssets = conversation.assets.slice().sort(sortByCreatedAt);
  const limit = Math.max(4, options.assetLimit ?? 10);

  if (sortedAssets.length <= limit) {
    return sortedAssets;
  }

  const requiredAssetIds = new Set(options.requiredAssetIds ?? []);
  const queryTokens = relevanceTokens(options.userText ?? "");
  const recentMessages = new Set(conversation.messages.slice(-8).map((message) => message.id));
  const generatedAssets = sortedAssets.filter((asset) => asset.kind === "generated");
  const uploadedAssets = sortedAssets.filter((asset) => asset.kind === "upload");
  const latestAssetIds = new Set(sortedAssets.slice(-4).map((asset) => asset.id));
  const latestGeneratedId = generatedAssets.at(-1)?.id;
  const latestUploadId = uploadedAssets.at(-1)?.id;

  const ordinalMatch = /第\s*(\d+)\s*(?:张|版)/.exec(options.userText ?? "");
  if (ordinalMatch) {
    const ordinalAsset = generatedAssets[Number(ordinalMatch[1]) - 1];
    if (ordinalAsset) {
      requiredAssetIds.add(ordinalAsset.id);
    }
  }
  if (/(?:原图|上传的那张|商品原图)/.test(options.userText ?? "") && latestUploadId) {
    requiredAssetIds.add(latestUploadId);
  }

  const scored = sortedAssets.map((asset, index) => {
    let score = index / Math.max(1, sortedAssets.length);
    if (requiredAssetIds.has(asset.id)) {
      score += 1_000;
    }
    if (latestAssetIds.has(asset.id)) {
      score += 80;
    }
    if (asset.id === latestGeneratedId || asset.id === latestUploadId) {
      score += 80;
    }
    if (asset.sourceMessageId && recentMessages.has(asset.sourceMessageId)) {
      score += 40;
    }
    if (asset.derivedFromAssetId && requiredAssetIds.has(asset.derivedFromAssetId)) {
      score += 100;
    }
    if (asset.derivedFromAssetId && latestAssetIds.has(asset.derivedFromAssetId)) {
      score += 20;
    }

    const candidateTokens = relevanceTokens(assetSearchText(conversation, asset.id));
    let overlap = 0;
    for (const token of queryTokens) {
      if (candidateTokens.has(token)) {
        overlap += token.length >= 4 ? 5 : token.length === 3 ? 3 : 1;
      }
    }
    score += Math.min(120, overlap);

    return { asset, score };
  });

  return scored
    .sort((a, b) => b.score - a.score || sortByCreatedAt(b.asset, a.asset))
    .slice(0, limit)
    .map(({ asset }) => asset)
    .sort(sortByCreatedAt);
};

const buildAssetCatalog = (
  conversation: PersistedConversation,
  assets: PersistedConversation["assets"],
) => {
  if (!assets.length) {
    return CONVERSATION_CONTEXT_PROMPTS.assetCatalogEmpty;
  }

  const catalog = assets
    .slice()
    .sort(sortByCreatedAt)
    .map((asset) => {
      const sourceMessage = getMessageById(conversation, asset.sourceMessageId);
      const observationSummary = asset.observations
        ? `observed: ${truncate(
            [
              asset.observations.mainSubject,
              asset.observations.style,
              asset.observations.dominantColors.length
                ? `colors: ${asset.observations.dominantColors.join("/")}`
                : "",
              asset.observations.ocrText ? `text: ${asset.observations.ocrText}` : "",
            ]
              .filter(Boolean)
              .join("; "),
            140,
          )}`
        : null;
      const semanticSummary = asset.semanticSummary
        ? `semantic: ${truncate(asset.semanticSummary.summary, 180)}`
        : null;
      const referenceDimensions = asset.semanticSummary?.referenceDimensions.length
        ? `reusable: ${asset.semanticSummary.referenceDimensions.join("/")}`
        : null;
      const editableRegions = asset.semanticSummary?.editableRegions.length
        ? `editable: ${asset.semanticSummary.editableRegions.join("/")}`
        : null;
      const parts = [
        asset.id,
        asset.kind,
        asset.label,
        `focus: ${truncate(asset.focus, 72)}`,
        observationSummary,
        semanticSummary,
        referenceDimensions,
        editableRegions,
        asset.derivedFromAssetId ? `derivedFrom: ${asset.derivedFromAssetId}` : null,
        sourceMessage?.text ? `boundTo: ${truncate(sourceMessage.text, 64)}` : null,
      ].filter(Boolean);

      return `- ${parts.join(" | ")}`;
    })
    .join("\n");

  const omittedCount = Math.max(0, conversation.assets.length - assets.length);
  return omittedCount
    ? `${catalog}\n- … ${omittedCount} older or less relevant assets omitted by context compression.`
    : catalog;
};

export const buildPlannerReferenceBlock = (
  conversation: PersistedConversation,
  assetIds: string[],
  emptyLabel: string,
) => {
  if (!assetIds.length) {
    return emptyLabel;
  }

  return assetIds
    .map((assetId) => {
      const asset = getAssetById(conversation, assetId);

      if (!asset) {
        return null;
      }

      const parentAsset = getAssetById(conversation, asset.derivedFromAssetId);
      return [
        asset.id,
        asset.kind,
        asset.label,
        `focus: ${truncate(asset.focus, 72)}`,
        parentAsset ? `derivedFrom: ${parentAsset.label}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join("\n");
};

export const buildConversationContextSnapshot = (
  conversation: PersistedConversation,
  options: ConversationContextOptions = {},
) => {
  const generatedAssets = listGeneratedAssets(conversation);
  const latestGenerated = generatedAssets.at(-1);
  const latestThreeLabels = latestItems(generatedAssets.map((asset) => asset.label), 3);
  const relevantAssets = selectRelevantAssetsForContext(conversation, options);
  const relevantAssetIds = new Set(relevantAssets.map((asset) => asset.id));

  return {
    title: inferConversationTitle(conversation),
    subtitle: buildSubtitle(conversation),
    carryHint: buildCarryHint(conversation),
    conversationSummary:
      conversation.summary?.text ?? "No persistent conversation summary yet.",
    preferenceSummary: buildPreferenceSummary(conversation, options.userPreferences),
    assetCatalog: buildAssetCatalog(conversation, relevantAssets),
    visualTimeline: buildVisualTimeline(conversation, relevantAssetIds),
    relevantAssetIds: relevantAssets.map((asset) => asset.id),
    recentResultSummary: latestGenerated
      ? formatPromptTemplate(CONVERSATION_CONTEXT_PROMPTS.recentResultSummaryTemplate, {
          latestLabelList: formatAsQuotedList([latestGenerated.label]),
          latestThreeLabelList: formatAsQuotedList(latestThreeLabels),
        })
      : CONVERSATION_CONTEXT_PROMPTS.recentResultSummaryEmpty,
  };
};
