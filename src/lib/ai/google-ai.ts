import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PUBLIC_REASONING_STATUS_SYSTEM_PROMPT,
  STRUCTURED_REASONING_GUIDANCE,
} from "@/lib/agent/reasoning-prompt";
import {
  getConfiguredImageModelSelection,
  listImageProviders,
} from "@/lib/ai/image-models";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_API_KEY_FILE = path.join(process.cwd(), "Gemini-API-Key.txt");
const GENERIC_API_KEY_FILE = path.join(process.cwd(), "API-Key.txt");

export const DEFAULT_AGENT_MODEL = "gemini-3.7-flash";
export const DEFAULT_PERCEPTION_MODEL = "gemini-3.1-flash-lite-preview";

export type InlineReferenceImage = {
  mimeType: string;
  base64Data: string;
};

export type GenerateImageInput = {
  prompt: string;
  model?: string;
  aspectRatio?: "1:1" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9";
  /** Resolution tier passed to imageConfig.imageSize (e.g. "1K" | "2K" | "4K"). */
  imageSize?: string;
  references?: InlineReferenceImage[];
};

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export type GenerateStructuredJsonInput = {
  prompt?: string;
  parts?: GeminiPart[];
  jsonSchema: Record<string, unknown>;
  model?: string;
  systemInstruction?: string;
  cachedContent?: string;
  onReasoningDelta?: (delta: string) => void;
};

export type GenerateTextInput = {
  prompt?: string;
  parts?: GeminiPart[];
  model?: string;
  systemInstruction?: string;
  cachedContent?: string;
};

export type GeneratedInlineImage = {
  mimeType: string;
  base64Data: string;
};

type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        thought?: boolean;
        thoughtSignature?: string;
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
      }>;
    };
  }>;
  usageMetadata?: GeminiUsageMetadata;
};

const parseGeminiSseRecords = (buffer: string) => {
  const records: string[] = [];
  let remainder = buffer;

  while (true) {
    const boundary = /\r?\n\r?\n/.exec(remainder);
    if (!boundary || boundary.index === undefined) {
      break;
    }

    records.push(remainder.slice(0, boundary.index));
    remainder = remainder.slice(boundary.index + boundary[0].length);
  }

  return { records, remainder };
};

const readGeminiStructuredStream = async <T>(
  response: Response,
  onReasoningDelta: (delta: string) => void,
) => {
  if (!response.body) {
    throw new Error("Gemini structured output stream returned no body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const raw: GeminiGenerateContentResponse[] = [];
  let buffer = "";
  let text = "";
  let usage: GeminiUsageMetadata | undefined;

  const consumeRecord = (record: string) => {
    const payload = record
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();

    if (!payload || payload === "[DONE]") {
      return;
    }

    const chunk = JSON.parse(payload) as GeminiGenerateContentResponse;
    raw.push(chunk);
    usage = chunk.usageMetadata ?? usage;

    for (const candidate of chunk.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (!part.text) {
          continue;
        }
        if (part.thought) {
          onReasoningDelta(part.text);
        } else {
          text += part.text;
        }
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parsed = parseGeminiSseRecords(buffer);
    buffer = parsed.remainder;
    parsed.records.forEach(consumeRecord);
  }

  buffer += decoder.decode();
  const tail = parseGeminiSseRecords(`${buffer}\n\n`);
  tail.records.forEach(consumeRecord);
  const normalizedText = text.trim();

  if (!normalizedText) {
    throw new Error("Gemini structured output returned no text.");
  }

  return {
    raw,
    text: normalizedText,
    data: JSON.parse(normalizedText) as T,
    usage,
  };
};

const extractLabeledApiKey = (rawValue: string, labels: string[]) => {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  const line = rawValue
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => {
      const label = entry.split(/[=:：]/)[0]?.trim().toLowerCase();
      return normalizedLabels.includes(label);
    });

  if (!line) {
    return null;
  }

  return line.replace(/^[^=:：]+[=:：]\s*/, "").trim() || null;
};

const readApiKeyFromFile = (filePath: string) => {
  try {
    const fileValue = readFileSync(filePath, "utf8").trim();
    return fileValue || null;
  } catch {
    return null;
  }
};

export const getGeminiApiKey = (): string | null => {
  return (
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    readApiKeyFromFile(GEMINI_API_KEY_FILE) ||
    extractLabeledApiKey(readApiKeyFromFile(GENERIC_API_KEY_FILE) ?? "", ["gemini", "google"])
  );
};

export const streamPublicReasoningWithGemini = async (input: {
  model: string;
  prompt: string;
  onDelta: (delta: string) => void;
}) => {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY or GOOGLE_API_KEY.");
  }

  const response = await fetch(
    `${GEMINI_BASE_URL}/models/${input.model}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: PUBLIC_REASONING_STATUS_SYSTEM_PROMPT,
            },
          ],
        },
        contents: [{ parts: [{ text: input.prompt }] }],
        generationConfig: {
          maxOutputTokens: 512,
          temperature: 0.5,
        },
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini public reasoning stream failed: ${response.status} ${detail}`);
  }
  if (!response.body) {
    throw new Error("Gemini public reasoning stream returned no body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let text = "";
  let usage: GeminiUsageMetadata | undefined;

  const consumeRecord = (record: string) => {
    const payload = record
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();

    if (!payload || payload === "[DONE]") {
      return;
    }

    const chunk = JSON.parse(payload) as GeminiGenerateContentResponse;
    usage = chunk.usageMetadata ?? usage;
    for (const candidate of chunk.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.text && !part.thought) {
          text += part.text;
          input.onDelta(part.text);
        }
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseGeminiSseRecords(buffer);
    buffer = parsed.remainder;
    parsed.records.forEach(consumeRecord);
  }

  buffer += decoder.decode();
  const tail = parseGeminiSseRecords(`${buffer}\n\n`);
  tail.records.forEach(consumeRecord);

  return { text: text.trim(), usage };
};

export const getGeminiPerceptionModel = () =>
  process.env.GEMINI_PERCEPTION_MODEL?.trim() || DEFAULT_PERCEPTION_MODEL;

export const getRuntimeConfig = () => ({
  provider: getConfiguredImageModelSelection().provider.displayName,
  imageModel: getConfiguredImageModelSelection().model.displayName,
  imageProviderId: getConfiguredImageModelSelection().provider.id,
  imageModelId: getConfiguredImageModelSelection().model.id,
  imageProviderModel: getConfiguredImageModelSelection().model.providerModel,
  imageProviders: listImageProviders().map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    models: provider.models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      providerModel: model.providerModel,
      capabilities: model.capabilities,
    })),
  })),
  agentModel: DEFAULT_AGENT_MODEL,
  apiKeyConfigured: Boolean(getGeminiApiKey()),
});

export const buildImageRequestPayload = (input: GenerateImageInput) => {
  const parts = [
    { text: input.prompt },
    ...(input.references ?? []).map((reference) => ({
      inlineData: {
        mimeType: reference.mimeType,
        data: reference.base64Data,
      },
    })),
  ];

  return {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["Image"],
      imageConfig:
        input.aspectRatio || input.imageSize
          ? {
              ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
              ...(input.imageSize ? { imageSize: input.imageSize } : {}),
            }
          : undefined,
    },
  };
};

const extractTextParts = (response: GeminiGenerateContentResponse): string[] => {
  const texts: string[] = [];

  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.text) {
        texts.push(part.text);
      }
    }
  }

  return texts;
};

export const extractBase64Images = (
  response: GeminiGenerateContentResponse,
): GeneratedInlineImage[] => {
  const images: GeneratedInlineImage[] = [];

  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data) {
        images.push({
          mimeType: part.inlineData.mimeType ?? "image/png",
          base64Data: part.inlineData.data,
        });
      }
    }
  }

  return images;
};

export const generateImageWithSelectedModel = async (input: GenerateImageInput) => {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY or GOOGLE_API_KEY.");
  }

  const model = input.model ?? getConfiguredImageModelSelection().model.providerModel;
  const response = await fetch(`${GEMINI_BASE_URL}/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(buildImageRequestPayload(input)),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini image generation failed: ${response.status} ${detail}`);
  }

  const data = (await response.json()) as GeminiGenerateContentResponse;
  return {
    raw: data,
    images: extractBase64Images(data),
  };
};


export const generateStructuredJsonWithGemini = async <T>(
  input: GenerateStructuredJsonInput,
) => {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY or GOOGLE_API_KEY.");
  }

  const model = input.model ?? getRuntimeConfig().agentModel;
  const baseParts: GeminiPart[] =
    input.parts && input.parts.length
      ? input.parts
      : [{ text: input.prompt ?? "" }];
  const parts: GeminiPart[] = input.onReasoningDelta
    ? [{ text: STRUCTURED_REASONING_GUIDANCE }, ...baseParts]
    : baseParts;

  const body: Record<string, unknown> = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: input.jsonSchema,
      ...(input.onReasoningDelta
        ? { thinkingConfig: { includeThoughts: true } }
        : {}),
    },
  };

  if (input.systemInstruction) {
    body.systemInstruction = { parts: [{ text: input.systemInstruction }] };
  }

  if (input.cachedContent) {
    body.cachedContent = input.cachedContent;
  }

  const operation = input.onReasoningDelta
    ? "streamGenerateContent?alt=sse"
    : "generateContent";
  const response = await fetch(`${GEMINI_BASE_URL}/models/${model}:${operation}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini structured output failed: ${response.status} ${detail}`);
  }

  if (input.onReasoningDelta) {
    return readGeminiStructuredStream<T>(response, input.onReasoningDelta);
  }

  const data = (await response.json()) as GeminiGenerateContentResponse;
  const text = extractTextParts(data).join("\n").trim();

  if (!text) {
    throw new Error("Gemini structured output returned no text.");
  }

  return {
    raw: data,
    text,
    data: JSON.parse(text) as T,
    usage: data.usageMetadata,
  };
};

export const generateTextWithGemini = async (input: GenerateTextInput) => {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY or GOOGLE_API_KEY.");
  }

  const model = input.model ?? getRuntimeConfig().agentModel;
  const parts: GeminiPart[] =
    input.parts && input.parts.length
      ? input.parts
      : [{ text: input.prompt ?? "" }];

  const body: Record<string, unknown> = {
    contents: [{ parts }],
  };

  if (input.systemInstruction) {
    body.systemInstruction = { parts: [{ text: input.systemInstruction }] };
  }

  if (input.cachedContent) {
    body.cachedContent = input.cachedContent;
  }

  const response = await fetch(`${GEMINI_BASE_URL}/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini text generation failed: ${response.status} ${detail}`);
  }

  const data = (await response.json()) as GeminiGenerateContentResponse;
  const text = extractTextParts(data).join("\n").trim();

  if (!text) {
    throw new Error("Gemini text generation returned no text.");
  }

  return {
    raw: data,
    text,
    usage: data.usageMetadata,
  };
};

type CacheEntry = {
  handle: string;
  expiresAt: number;
};

const SYSTEM_CACHE_TTL_MS = 50 * 60 * 1000; // 50 minutes (Gemini default cache TTL is 60m)
const systemCacheByKey = new Map<string, CacheEntry>();

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
};

/**
 * Ensure a Gemini cachedContents entry exists for the given system text and model.
 * Returns null if caching is unavailable (no API key, cache API failure, etc.).
 * Callers should fall back to inlining the system text on null.
 */
export const ensureSystemPromptCache = async (params: {
  systemText: string;
  model?: string;
  ttlSeconds?: number;
}): Promise<string | null> => {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    return null;
  }

  const model = params.model ?? getRuntimeConfig().agentModel;
  const cacheKey = `${model}:${hashString(params.systemText)}`;
  const existing = systemCacheByKey.get(cacheKey);

  if (existing && existing.expiresAt > Date.now() + 60_000) {
    return existing.handle;
  }

  try {
    const ttlSeconds = params.ttlSeconds ?? Math.floor(SYSTEM_CACHE_TTL_MS / 1000);
    const response = await fetch(`${GEMINI_BASE_URL}/cachedContents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model: `models/${model}`,
        systemInstruction: {
          parts: [{ text: params.systemText }],
        },
        ttl: `${ttlSeconds}s`,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      // Cache may not be supported for this model; degrade silently.
      return null;
    }

    const data = (await response.json()) as { name?: string };
    if (!data.name) {
      return null;
    }

    systemCacheByKey.set(cacheKey, {
      handle: data.name,
      expiresAt: Date.now() + SYSTEM_CACHE_TTL_MS,
    });
    return data.name;
  } catch {
    return null;
  }
};
