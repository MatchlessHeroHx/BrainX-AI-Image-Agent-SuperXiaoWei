import type { SkillBrief, SkillConfidence } from "@/lib/types";

export type SkillDefaultAction = "clarify_or_generate" | "discuss" | "generate";
export type SkillExecutionMode = "generic" | "custom";

export type SkillManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  triggers: string[];
  antiTriggers: string[];
  defaultAction?: SkillDefaultAction;
  /** Generic Skills are prompt-only plugins handled by the DeepSeek harness. */
  executionMode: SkillExecutionMode;
  /** Only custom pseudo-Skills may name an application-owned workflow. */
  customWorkflowId?: string;
  directoryName: string;
};

export type SkillRuntimeResource = {
  id: string;
  name: string;
  description?: string;
  file: string;
  content: string;
  triggers: string[];
  aPlusStages: string[];
  selectedModules: string[];
  preferredAgentProviderId?: string;
  preferredAgentModelId?: string;
};

export type LoadedSkill = SkillManifest & {
  body: string;
  fullText: string;
  examples?: SkillExamplesFile;
  runtimeResources: SkillRuntimeResource[];
};

export type SelectedSkillRuntimeResource = {
  skill: LoadedSkill;
  resource: SkillRuntimeResource;
};

export type SkillExamplesFile = {
  positive: SkillExample[];
  negative: SkillExample[];
};

export type SkillExample = {
  id: string;
  input: string;
  expectedSkillId?: string;
  expectedAction?: string;
  assertions?: string[];
  reason?: string;
};

export type SkillSelectionContext = {
  userText: string;
  activeSkillId?: string;
  limit?: number;
};

export type SkillPlanningFields = {
  selectedSkillId?: string;
  skillConfidence?: SkillConfidence;
  skillBrief?: SkillBrief;
};
