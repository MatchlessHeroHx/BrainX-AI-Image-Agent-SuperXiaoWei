import type {
  LoadedSkill,
  SelectedSkillRuntimeResource,
} from "@/lib/agent/skill-types";
import type { ConversationAgentState } from "@/lib/types";

export type CustomWorkflowResourceSelectionInput = {
  skill: LoadedSkill;
  agentState?: ConversationAgentState;
  userText: string;
};

export type CustomWorkflowDefinition = {
  id: string;
  plannerInstructions: string[];
  selectRuntimeResources: (
    input: CustomWorkflowResourceSelectionInput,
  ) => SelectedSkillRuntimeResource[];
};
