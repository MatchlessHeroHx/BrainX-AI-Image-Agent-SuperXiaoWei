import { selectAPlusRuntimeResources } from "@/lib/agent/custom-workflows/a-plus/resource-selector";
import type { CustomWorkflowDefinition } from "@/lib/agent/custom-workflows/types";

const workflows: Record<string, CustomWorkflowDefinition> = {
  "a-plus": {
    id: "a-plus",
    plannerInstructions: [
      "When producing an A+ guidance template, the user-facing name is 电商图方案. Do not expose the full guidance template in assistantReply; only say the 电商图方案 is ready and summarize it briefly. Module prompts can still be included in assistantReply when not generating, or in generation.prompt when generating.",
      "When generating multiple A+ modules or multiple distinct方案 at once, use generation.tasks with one independent prompt per module/方案. Do not compress several modules into one generic prompt; generation.outputCount is only same-prompt samples per task.",
      "For A+ turns, set skillBrief.aPlusStage and skillBrief.selectedModule whenever they are known so the system can save and reuse intermediate artifacts.",
    ],
    selectRuntimeResources: selectAPlusRuntimeResources,
  },
};

export function getCustomWorkflowDefinition(workflowId: string) {
  const workflow = workflows[workflowId];
  if (!workflow) {
    throw new Error(`Custom Skill workflow is not registered: ${workflowId}`);
  }
  return workflow;
}
