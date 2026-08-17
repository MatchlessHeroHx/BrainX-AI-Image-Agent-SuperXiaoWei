import {
  getConfiguredAgentModelSelection,
  resolveAgentModelSelection,
  type AgentProviderId,
} from "@/lib/ai/agent-models";
import { deepSeekHarnessAdapter } from "@/lib/agent/harness/providers/deepseek";
import { geminiHarnessAdapter } from "@/lib/agent/harness/providers/gemini";
import type { AgentHarnessAdapter } from "@/lib/agent/harness/types";

const adapters: Record<AgentProviderId, AgentHarnessAdapter> = {
  deepseek: deepSeekHarnessAdapter,
  "google-ai-studio": geminiHarnessAdapter,
};

export function getAgentHarnessAdapter(providerId: AgentProviderId) {
  const adapter = adapters[providerId];

  if (!adapter) {
    throw new Error(`Agent harness adapter is not registered: ${providerId}`);
  }

  return adapter;
}

export function resolveAgentHarnessRuntime(params?: {
  providerId?: string;
  modelId?: string;
}) {
  const selection = params
    ? resolveAgentModelSelection(params)
    : getConfiguredAgentModelSelection();

  return {
    ...selection,
    adapter: getAgentHarnessAdapter(selection.provider.id),
  };
}

export const getConfiguredAgentHarnessRuntime = () => resolveAgentHarnessRuntime();
