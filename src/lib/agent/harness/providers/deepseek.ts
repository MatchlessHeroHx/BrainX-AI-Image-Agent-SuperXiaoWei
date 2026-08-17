import {
  generateStructuredJsonWithDeepSeek,
  getDeepSeekApiKey,
  streamPublicReasoningWithDeepSeek,
} from "@/lib/ai/deepseek-ai";
import type {
  AgentHarnessAdapter,
  AgentHarnessStructuredInput,
} from "@/lib/agent/harness/types";

export const deepSeekHarnessAdapter: AgentHarnessAdapter = {
  id: "deepseek",
  isConfigured: () => Boolean(getDeepSeekApiKey()),
  async generateStructuredJson<T>(input: AgentHarnessStructuredInput) {
    const result = await generateStructuredJsonWithDeepSeek<T>({
      model: input.model.providerModel,
      prompt: input.prompt,
      jsonSchema: input.jsonSchema,
      systemInstruction: input.systemInstruction,
      onReasoningDelta: input.onReasoningDelta,
    });

    return {
      raw: result.raw,
      text: result.text,
      data: result.data,
      usage: result.usage
        ? {
            inputTokens: result.usage.prompt_tokens,
            outputTokens: result.usage.completion_tokens,
            totalTokens: result.usage.total_tokens,
          }
        : undefined,
    };
  },
  async streamPublicReasoning(input) {
    const result = await streamPublicReasoningWithDeepSeek({
      model: input.model.providerModel,
      prompt: input.prompt,
      onDelta: input.onDelta,
    });

    return {
      text: result.text,
      usage: result.usage
        ? {
            inputTokens: result.usage.prompt_tokens,
            outputTokens: result.usage.completion_tokens,
            totalTokens: result.usage.total_tokens,
          }
        : undefined,
    };
  },
};
