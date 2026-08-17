import uiPrompts from "../../../prompts/image-agent/ui-prompts.json";

export type QuickPrompt = {
  label: string;
  prompt: string;
};

type ImageAgentUiPrompts = {
  initialPrompts: QuickPrompt[];
  referencePrompts: QuickPrompt[];
  selectedReferencePrompt: string;
  thinkingStatus: {
    title: string;
    detail: string;
  };
  generatingStatus: {
    title: string;
    detail: string;
  };
  generationForm: {
    title: string;
    intro: string;
    aspectRatioLabel: string;
    resolutionLabel: string;
    outputCountLabel: string;
    submitLabel: string;
    retryLabel: string;
    submittedTitle: string;
    submittedHint: string;
    countUnit: string;
    noResolutionHint: string;
  };
  aPlusBriefForm: {
    title: string;
    intro: string;
    productNameLabel: string;
    productNamePlaceholder: string;
    sellingPointsLabel: string;
    sellingPointsPlaceholder: string;
    targetCountryLabel: string;
    targetCountryPlaceholder: string;
    salesPlatformLabel: string;
    salesPlatformPlaceholder: string;
    candidateLabel: string;
    submitLabel: string;
    submittedTitle: string;
    submittedHint: string;
    optionalHint: string;
  };
};

export const IMAGE_AGENT_UI_PROMPTS = uiPrompts as ImageAgentUiPrompts;
