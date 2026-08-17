export type AssetKind = "upload" | "generated";
export type MessageRole = "user" | "assistant";
export type AgentMode =
  | "discuss"
  | "clarify"
  | "generate"
  | "edit"
  | "reference_generate"
  | "reframe";
export type PlannerAction = AgentMode;
export type SkillConfidence = "high" | "medium" | "low";
export type SkillBriefValue = string | string[] | boolean | number | null;
export type SkillBrief = Record<string, SkillBriefValue>;
export type SkillSummary = {
  id: string;
  name: string;
  version: string;
  description: string;
  triggers: string[];
  antiTriggers: string[];
  defaultAction?: "clarify_or_generate" | "discuss" | "generate";
  directoryName: string;
};

export type ImageObservation = {
  mainSubject: string;
  style: string;
  dominantColors: string[];
  containsText: boolean;
  captionZh?: string;
  ocrText?: string;
  hasLogo: boolean;
  compositionHint?: string;
  /** Visual dimensions that are safe/useful to borrow for a new composition. */
  referenceDimensions?: string[];
  /** Concrete regions or layers that can be targeted by an edit request. */
  editableRegions?: string[];
  capturedAt: string;
};

export type AssetSemanticSummary = {
  summary: string;
  subject?: string;
  style?: string;
  palette?: string[];
  composition?: string;
  referenceDimensions: string[];
  editableRegions: string[];
  updatedAt: string;
};

export type ImageAsset = {
  id: string;
  kind: AssetKind;
  label: string;
  alt: string;
  focus: string;
  url: string;
  externalUrl?: string;
  mimeType: string;
  width: number;
  height: number;
  createdAt: string;
  sourceMessageId?: string;
  derivedFromAssetId?: string;
  observations?: ImageObservation;
  semanticSummary?: AssetSemanticSummary;
};

export type GenerationMode = Exclude<PlannerAction, "discuss" | "clarify">;

/** Parameters the user fills in on the generation form before an image is produced. */
export type GenerationFormParams = {
  aspectRatio: string;
  /** Resolution tier (e.g. "1K" | "2K" | "4K"). Empty string when the model has no resolution control. */
  resolution: string;
  outputCount: number;
};

export type PlannedGenerationTask = {
  label?: string;
  prompt: string;
  referenceAssetIds: string[];
  inheritConversationContext: boolean;
  /** Optional A+ module id, e.g. "02", for saving module prompts as reusable artifacts. */
  aPlusModule?: string;
};

/**
 * A generation request the agent has prepared but intentionally left for the
 * user to confirm. The agent decides *what* to draw (mode/prompt/references) but
 * never the *output parameters* — those are collected via this form so the user
 * is always in control of aspect ratio, resolution and count.
 */
export type GenerationFormSpec = {
  status: "pending" | "submitted";
  mode: GenerationMode;
  prompt: string;
  referenceAssetIds: string[];
  /**
   * Distinct generation tasks prepared by the agent. `suggestedOutputCount` and
   * submitted `outputCount` still mean samples per task, preserving the existing
   * "same prompt, draw several variants" behavior.
   */
  tasks?: PlannedGenerationTask[];
  /** Pre-filled suggestions for the form controls; the user may override any of them. */
  suggestedAspectRatio: string;
  suggestedResolution: string;
  suggestedOutputCount: number;
  /** The image model this form was prepared against (controls available options on the client). */
  imageProviderId?: string;
  imageModelId?: string;
  /** Populated once the user submits the form and generation has run. */
  submittedParams?: GenerationFormParams;
};

export type APlusBriefValues = {
  productName: string;
  sellingPoints: string;
  targetCountry: string;
  salesPlatform: string;
};

export type APlusBriefCandidateValues = Partial<Record<keyof APlusBriefValues, string[]>>;

export type APlusBriefFormSpec = {
  status: "pending" | "submitted";
  initialValues?: Partial<APlusBriefValues>;
  candidateValues?: APlusBriefCandidateValues;
  submittedValues?: APlusBriefValues;
};

export type GenerationAttemptStatus = "ok" | "fail";

export type GenerationErrorClass =
  | "reference_rejected"
  | "reference_too_many"
  | "prompt_too_long"
  | "provider_quota"
  | "provider_outage"
  | "network"
  | "config"
  | "unknown";

export type GenerationAttempt = {
  strategy: string;
  providerId: string;
  modelId: string;
  status: GenerationAttemptStatus;
  durationMs?: number;
  errorClass?: GenerationErrorClass;
  errorMessage?: string;
};

export type AgentTrace = {
  referenceResolution?: {
    inferredAssetIds: string[];
    note?: string;
    hardReset: boolean;
  };
  planning?: {
    action: PlannerAction;
    shouldGenerate: boolean;
    referenceAssetIds: string[];
    inheritConversationContext?: boolean;
    selectedSkillId?: string;
    skillConfidence?: SkillConfidence;
    skillBrief?: SkillBrief;
    memoryUpdate?: PlannerMemoryUpdate;
    rationale?: string;
  };
  generation?: {
    providerId: string;
    modelId: string;
    usedFallback: boolean;
    attempts: GenerationAttempt[];
  };
  errorMessage?: string;
};

export type ConversationMessage = {
  id: string;
  role: MessageRole;
  text: string;
  /** A concise, user-facing summary of how the agent approached the turn. */
  reasoning?: string;
  createdAt: string;
  mode: AgentMode;
  /** Short, user-facing note. Most turns leave this empty; only set for explicit follow-ups (e.g. "缺少可编辑参考图"). */
  userNote?: string;
  /** Developer-facing trace. Never rendered to users; surfaced via debug panel. */
  debugTrace?: AgentTrace;
  /** Present on assistant turns that prepared a generation but left the output parameters to the user. */
  generationForm?: GenerationFormSpec;
  /** Present on assistant turns that collect an optional A+ brief before planning modules. */
  aPlusBriefForm?: APlusBriefFormSpec;
  attachments?: ImageAsset[];
};

export type SessionSummary = {
  id: string;
  title: string;
  lastUserIntent: string;
  updatedAt: string;
  isActive?: boolean;
};

export type GeneratedHistoryItem = {
  id: string;
  index: number;
  title: string;
  note: string;
  createdAt: string;
  sourceMessageId: string;
  sourceLabel?: string;
  derivedFromTitle?: string;
  asset: ImageAsset;
};

export type RuntimeConfig = {
  provider: string;
  imageModel: string;
  imageProviderId: string;
  imageModelId: string;
  imageProviderModel: string;
  imageProviders: Array<{
    id: string;
    displayName: string;
    configured?: boolean;
    models: Array<{
      id: string;
      displayName: string;
      providerModel: string;
      capabilities: {
        textToImage: boolean;
        imageToImage: boolean;
        multiImageReference: boolean;
        maxReferenceImages: number;
        aspectRatios: string[];
        resolutions: string[];
        inputReferenceKind?: string;
        outputKind?: string;
        executionKind?: string;
      };
    }>;
  }>;
  agentProviderId: string;
  agentModelId: string;
  agentProviderModel: string;
  agentModel: string;
  agentProviders: Array<{
    id: string;
    displayName: string;
    configured?: boolean;
    models: Array<{
      id: string;
      displayName: string;
      providerModel: string;
      capabilities: {
        structuredJson: boolean;
        vision: boolean;
        promptCaching: boolean;
      };
    }>;
  }>;
  agentApiKeyConfigured: boolean;
  apiKeyConfigured: boolean;
};

export type CurrentSessionView = {
  id: string;
  title: string;
  subtitle: string;
  carryHint: string;
  activeSkillId?: string;
  activeReferences: number;
  generatedCount: number;
  messages: ConversationMessage[];
};

export type WorkspaceState = {
  sessions: SessionSummary[];
  currentSession: CurrentSessionView;
  history: GeneratedHistoryItem[];
  availableSkills: SkillSummary[];
  runtime: RuntimeConfig;
};

export type PlannerOutput = {
  assistantReply: string;
  /** Safe-to-display reasoning summary; never contains raw hidden chain-of-thought. */
  reasoningSummary?: string;
  nextAction: PlannerAction;
  selectedSkillId?: string;
  skillConfidence?: SkillConfidence;
  skillBrief?: SkillBrief;
  shouldGenerate: boolean;
  needsClarification: boolean;
  generation:
    | {
        mode: Exclude<PlannerAction, "discuss" | "clarify">;
        prompt: string;
        referenceAssetIds: string[];
        inheritConversationContext: boolean;
        outputCount: number;
        tasks?: PlannedGenerationTask[];
      }
    | null;
  /** Internal artifacts saved for later turns. Never rendered directly to users. */
  internalArtifacts?: {
    aPlusGuidanceTemplate?: string;
    aPlusModulePrompts?: Record<string, string>;
  };
  /** Compact memory produced alongside planning; it is never rendered to users. */
  memoryUpdate?: PlannerMemoryUpdate;
};

export type PlannerMemoryUpdate = {
  conversationSummary?: string;
  learnedUserPreferences?: string[];
  removedUserPreferences?: string[];
};

export type APlusArtifact = {
  text: string;
  updatedAt: string;
  sourceMessageId?: string;
};

export type APlusArtifacts = {
  guidanceTemplate?: APlusArtifact;
  modulePrompts?: Record<string, APlusArtifact>;
};

export type ConversationAgentState = {
  activeSkillId?: string;
  creativeBrief?: SkillBrief;
  aPlusArtifacts?: APlusArtifacts;
  openQuestions?: string[];
  updatedAt: string;
};

export type ConversationSummary = {
  text: string;
  /** Number of persisted messages represented by this summary. */
  summarizedMessageCount: number;
  updatedAt: string;
  sourceMessageId?: string;
};

export type UserPreferenceMemory = {
  value: string;
  updatedAt: string;
  sourceConversationId?: string;
};

export type GenerationJob = {
  id: string;
  triggerMessageId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  mode: Exclude<PlannerAction, "discuss" | "clarify">;
  promptForModel: string;
  imageProviderId?: string;
  imageModelId?: string;
  referenceAssetIds: string[];
  outputAssetIds: string[];
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  attempts?: GenerationAttempt[];
};

export type PersistedMessage = {
  id: string;
  role: MessageRole;
  text: string;
  /** A concise, user-facing summary of how the agent approached the turn. */
  reasoning?: string;
  createdAt: string;
  mode: AgentMode;
  /** Short, user-facing note. Empty for the vast majority of turns. */
  userNote?: string;
  /** Developer-facing trace; hidden from the chat UI by default. */
  debugTrace?: AgentTrace;
  /** Present on assistant turns that prepared a generation but left the output parameters to the user. */
  generationForm?: GenerationFormSpec;
  /** Present on assistant turns that collect an optional A+ brief before planning modules. */
  aPlusBriefForm?: APlusBriefFormSpec;
  attachmentIds: string[];
};

export type PersistedConversation = {
  id: string;
  title: string;
  subtitle: string;
  carryHint: string;
  agentState?: ConversationAgentState;
  summary?: ConversationSummary;
  createdAt: string;
  updatedAt: string;
  messages: PersistedMessage[];
  assets: ImageAsset[];
  jobs: GenerationJob[];
};

export type AppStore = {
  version: 1;
  /** Durable preferences shared by conversations. */
  userPreferences: UserPreferenceMemory[];
  conversations: PersistedConversation[];
};
