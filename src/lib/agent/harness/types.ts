import type { AgentModelDefinition, AgentProviderId } from "@/lib/ai/agent-models";

export type AgentHarnessPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export type AgentHarnessUsage = {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type AgentHarnessStructuredInput = {
  model: AgentModelDefinition;
  systemInstruction: string;
  prompt: string;
  parts?: AgentHarnessPart[];
  jsonSchema: Record<string, unknown>;
  /** Provider reasoning that has been explicitly constrained for live user display. */
  onReasoningDelta?: (delta: string) => void;
};

export type AgentHarnessStructuredResult<T> = {
  raw: unknown;
  text: string;
  data: T;
  usage?: AgentHarnessUsage;
};

export type AgentHarnessPublicReasoningInput = {
  model: AgentModelDefinition;
  prompt: string;
  onDelta: (delta: string) => void;
};

/**
 * The stable provider boundary used by the generic Agent harness.
 *
 * Planner and Skills must depend on this contract, never on a provider SDK.
 * Provider-specific behavior such as prompt caching, multimodal payloads and
 * usage normalization belongs inside the adapter.
 */
export type AgentHarnessAdapter = {
  id: AgentProviderId;
  isConfigured: () => boolean;
  generateStructuredJson: <T>(
    input: AgentHarnessStructuredInput,
  ) => Promise<AgentHarnessStructuredResult<T>>;
  streamPublicReasoning: (
    input: AgentHarnessPublicReasoningInput,
  ) => Promise<{ text: string; usage?: AgentHarnessUsage }>;
};
