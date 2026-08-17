import { promises as fs } from "node:fs";
import type { PlannerOutput } from "@/lib/types";
import {
  DEFAULT_IMAGE_AGENT_SYSTEM_PROMPT,
  IMAGE_AGENT_PROMPTS,
  IMAGE_AGENT_SYSTEM_PROMPT_FILE,
} from "@/lib/agent/prompt-config";

export {
  DEFAULT_IMAGE_AGENT_SYSTEM_PROMPT,
  IMAGE_AGENT_SYSTEM_PROMPT_FILE,
} from "@/lib/agent/prompt-config";

export async function loadImageAgentSystemPrompt() {
  try {
    const content = (await fs.readFile(IMAGE_AGENT_SYSTEM_PROMPT_FILE, "utf8")).trim();
    return content || DEFAULT_IMAGE_AGENT_SYSTEM_PROMPT;
  } catch {
    return DEFAULT_IMAGE_AGENT_SYSTEM_PROMPT;
  }
}

export const plannerOutputExample: PlannerOutput = IMAGE_AGENT_PROMPTS.plannerOutputExample;
