import {
  ensureSystemPromptCache,
  generateStructuredJsonWithGemini,
  getGeminiApiKey,
  streamPublicReasoningWithGemini,
  type GeminiPart,
} from "@/lib/ai/google-ai";
import type {
  AgentHarnessAdapter,
  AgentHarnessStructuredInput,
} from "@/lib/agent/harness/types";

export const geminiHarnessAdapter: AgentHarnessAdapter = {
  id: "google-ai-studio",
  isConfigured: () => Boolean(getGeminiApiKey()),
  async generateStructuredJson<T>(input: AgentHarnessStructuredInput) {
    const model = input.model.providerModel;
    const cachedContent = input.model.capabilities.promptCaching
      ? await ensureSystemPromptCache({ systemText: input.systemInstruction, model })
      : null;
    const result = await generateStructuredJsonWithGemini<T>({
      model,
      prompt: input.prompt,
      parts: input.parts as GeminiPart[] | undefined,
      jsonSchema: input.jsonSchema,
      systemInstruction: cachedContent ? undefined : input.systemInstruction,
      cachedContent: cachedContent ?? undefined,
      onReasoningDelta: input.onReasoningDelta,
    });

    return {
      raw: result.raw,
      text: result.text,
      data: result.data,
      usage: result.usage
        ? {
            inputTokens: result.usage.promptTokenCount,
            cachedInputTokens: result.usage.cachedContentTokenCount,
            outputTokens: result.usage.candidatesTokenCount,
            totalTokens: result.usage.totalTokenCount,
          }
        : undefined,
    };
  },
  async streamPublicReasoning(input) {
    const result = await streamPublicReasoningWithGemini({
      model: input.model.providerModel,
      prompt: input.prompt,
      onDelta: input.onDelta,
    });

    return {
      text: result.text,
      usage: result.usage
        ? {
            inputTokens: result.usage.promptTokenCount,
            cachedInputTokens: result.usage.cachedContentTokenCount,
            outputTokens: result.usage.candidatesTokenCount,
            totalTokens: result.usage.totalTokenCount,
          }
        : undefined,
    };
  },
};
