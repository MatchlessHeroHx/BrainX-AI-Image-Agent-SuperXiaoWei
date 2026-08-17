import path from "node:path";
import promptCopy from "../../../prompts/image-agent/runtime-copy.json";
import type { ImageAsset, PlannerAction, PlannerOutput } from "@/lib/types";

type GenerationAction = Exclude<PlannerAction, "discuss" | "clarify">;

type PromptControlConfig = {
  schemaDescriptions: {
    assistantReply: string;
    generationPrompt: string;
  };
  fallbackSystemPrompt: string[];
  plannerRuntimeInstructions: string[];
  behaviorDefaults: {
    vagueMultipleOutputCount: number;
  };
  fallbackImagePrompt: {
    prefixes: Record<GenerationAction, string>;
    continuityTemplate: string;
    uploadReferenceHint: string;
    userRequestPrefix: string;
    emptyUserRequest: string;
    vagueWordTranslations: Record<string, string>;
  };
  fallbackAssistantReplies: {
    offlineUnavailable: string;
    uploadOnlyClarify: string;
    emptyClarify: string;
    discuss: string;
    shortClarify: string;
    missingEditReferenceClarify: string;
    generate: string;
    reframeHardReset: string;
    reframeSoft: string;
    referenceGenerate: string;
    edit: string;
    iterationOnLatest: string;
  };
  assistantNotes: {
    clarification: string;
    singleResult: string;
    multipleResultTemplate: string;
    localPreviewTemplate: string;
    referenceGenerationTemplate: string;
    directGenerationTemplate: string;
    referenceResolutionTemplate: string;
  };
  failureMessage: {
    text: string;
    note: string;
  };
  assetText: {
    uploadFocus: string;
    defaultGeneratedLabel: string;
    localPreviewDirectionLabel: string;
  };
  plannerPrompt: {
    conversationTitleLabel: string;
    conversationSubtitleLabel: string;
    carryHintLabel: string;
    recentResultSummaryLabel: string;
    conversationSummaryLabel: string;
    availableAssetsLabel: string;
    visualTimelineLabel: string;
    newUploadsLabel: string;
    explicitReferencesLabel: string;
    inferredReferencesLabel: string;
    recentPreferencesLabel: string;
    recentConversationLabel: string;
    currentUserMessageLabel: string;
    emptyCurrentUserMessage: string;
    noNewUploads: string;
    noExplicitReferences: string;
    noInferredReferences: string;
  };
  workspaceText: {
    defaultHistoryNote: string;
    emptySessionIntent: string;
    initialAssistantText: string;
  };
  referenceResolver: {
    originalImageReason: string;
    secondLatestImageReason: string;
    latestImageReason: string;
    ordinalImageReasonTemplate: string;
    semanticMatchReasonTemplate: string;
  };
  conversationContext: {
    fallbackTitle: string;
    subtitleWithGeneratedTemplate: string;
    subtitleWithUploadsTemplate: string;
    subtitleWithLatestUser: string;
    subtitleEmpty: string;
    carryLatestGeneratedCurrentTemplate: string;
    carryLatestGeneratedParentTemplate: string;
    carryLatestGeneratedSourceTemplate: string;
    carryLatestGeneratedUserTemplate: string;
    carryLatestUploadTemplate: string;
    carryLatestUser: string;
    carryEmpty: string;
    preferenceEmpty: string;
    visualTimelineEmpty: string;
    assetCatalogEmpty: string;
    recentResultSummaryTemplate: string;
    recentResultSummaryEmpty: string;
  };
  plannerOutputExample: PlannerOutput;
};

export const IMAGE_AGENT_PROMPT_DIR = path.join(process.cwd(), "prompts", "image-agent");
export const IMAGE_AGENT_SYSTEM_PROMPT_FILE = path.join(IMAGE_AGENT_PROMPT_DIR, "system.md");
export const IMAGE_AGENT_PROMPTS = promptCopy as PromptControlConfig;
export const DEFAULT_IMAGE_AGENT_SYSTEM_PROMPT =
  IMAGE_AGENT_PROMPTS.fallbackSystemPrompt.join("\n");

export const formatPromptTemplate = (
  template: string,
  values: Record<string, string | number | undefined>,
) =>
  Object.entries(values).reduce(
    (current, [key, value]) => current.replaceAll(`{${key}}`, String(value ?? "")),
    template,
  );

export const expandVagueChineseWords = (input: string) => {
  if (!input) {
    return input;
  }

  const translations = IMAGE_AGENT_PROMPTS.fallbackImagePrompt.vagueWordTranslations;
  const sortedTerms = Object.keys(translations).sort((a, b) => b.length - a.length);

  return sortedTerms.reduce(
    (current, term) => current.split(term).join(translations[term]),
    input,
  );
};

export const buildFallbackImagePrompt = (params: {
  userText: string;
  mode: GenerationAction;
  referenceAssets: ImageAsset[];
  hasUploads: boolean;
  inheritConversationContext: boolean;
}) => {
  const copy = IMAGE_AGENT_PROMPTS.fallbackImagePrompt;
  const primaryReference = params.referenceAssets[0];
  const referenceHint =
    params.inheritConversationContext && primaryReference
      ? formatPromptTemplate(copy.continuityTemplate, {
          label: primaryReference.label,
          focus: primaryReference.focus,
        })
      : params.hasUploads
        ? copy.uploadReferenceHint
        : "";

  const expandedRequest = params.userText ? expandVagueChineseWords(params.userText) : copy.emptyUserRequest;

  return `${copy.prefixes[params.mode]}${referenceHint}${copy.userRequestPrefix}${expandedRequest}`;
};

export const buildAssistantFailureMessage = () => IMAGE_AGENT_PROMPTS.failureMessage;
