import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PUBLIC_REASONING_STATUS_SYSTEM_PROMPT,
  STRUCTURED_REASONING_GUIDANCE,
} from "@/lib/agent/reasoning-prompt";

const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com";
const DEEPSEEK_API_KEY_FILE = path.join(process.cwd(), "DeepSeek-API-Key.txt");
const GENERIC_API_KEY_FILE = path.join(process.cwd(), "API-Key.txt");
const DEEPSEEK_KEY_PATTERN = /sk-[A-Za-z0-9._-]+/;

export type DeepSeekUsageMetadata = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type DeepSeekChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  usage?: DeepSeekUsageMetadata;
};

type DeepSeekChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
    };
  }>;
  usage?: DeepSeekUsageMetadata;
};

export type DeepSeekStructuredJsonInput = {
  model: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  systemInstruction: string;
  onReasoningDelta?: (delta: string) => void;
};

const parseSseRecords = (buffer: string) => {
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

const readDeepSeekStream = async <T>(
  response: Response,
  onReasoningDelta: (delta: string) => void,
) => {
  if (!response.body) {
    throw new Error("DeepSeek structured output stream returned no body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const raw: DeepSeekChatCompletionChunk[] = [];
  let buffer = "";
  let text = "";
  let usage: DeepSeekUsageMetadata | undefined;

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

    const chunk = JSON.parse(payload) as DeepSeekChatCompletionChunk;
    raw.push(chunk);
    usage = chunk.usage ?? usage;

    for (const choice of chunk.choices ?? []) {
      const reasoning = choice.delta?.reasoning_content ?? choice.delta?.reasoning;
      if (reasoning) {
        onReasoningDelta(reasoning);
      }
      if (choice.delta?.content) {
        text += choice.delta.content;
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseRecords(buffer);
    buffer = parsed.remainder;
    parsed.records.forEach(consumeRecord);
  }

  buffer += decoder.decode();
  const tail = parseSseRecords(`${buffer}\n\n`);
  tail.records.forEach(consumeRecord);
  const normalizedText = text.trim();

  if (!normalizedText) {
    throw new Error("DeepSeek structured output returned no text.");
  }

  return {
    raw,
    text: normalizedText,
    data: JSON.parse(normalizedText) as T,
    usage,
  };
};

const extractDeepSeekApiKey = (rawValue: string) => {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return null;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const deepSeekLine = lines.find((line) => /^deepseek\s*[=:：]/i.test(line));
  const lineToParse = deepSeekLine ?? (lines.length === 1 ? lines[0] : "");
  const keyMatch = lineToParse.match(DEEPSEEK_KEY_PATTERN) ?? trimmed.match(DEEPSEEK_KEY_PATTERN);

  return keyMatch?.[0] ?? lineToParse ?? null;
};

const readApiKeyFromFile = (filePath: string) => {
  try {
    return extractDeepSeekApiKey(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

export const getDeepSeekApiKey = (): string | null => {
  return (
    process.env.DEEPSEEK_API_KEY?.trim() ||
    readApiKeyFromFile(DEEPSEEK_API_KEY_FILE) ||
    readApiKeyFromFile(GENERIC_API_KEY_FILE)
  );
};

export const streamPublicReasoningWithDeepSeek = async (input: {
  model: string;
  prompt: string;
  onDelta: (delta: string) => void;
}) => {
  const apiKey = getDeepSeekApiKey();

  if (!apiKey) {
    throw new Error("Missing DEEPSEEK_API_KEY.");
  }

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        {
          role: "system",
          content: PUBLIC_REASONING_STATUS_SYSTEM_PROMPT,
        },
        { role: "user", content: input.prompt },
      ],
      thinking: { type: "disabled" },
      stream: true,
      stream_options: { include_usage: true },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DeepSeek public reasoning stream failed: ${response.status} ${detail}`);
  }
  if (!response.body) {
    throw new Error("DeepSeek public reasoning stream returned no body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let text = "";
  let usage: DeepSeekUsageMetadata | undefined;

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

    const chunk = JSON.parse(payload) as DeepSeekChatCompletionChunk;
    usage = chunk.usage ?? usage;
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta?.content;
      if (delta) {
        text += delta;
        input.onDelta(delta);
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseRecords(buffer);
    buffer = parsed.remainder;
    parsed.records.forEach(consumeRecord);
  }

  buffer += decoder.decode();
  const tail = parseSseRecords(`${buffer}\n\n`);
  tail.records.forEach(consumeRecord);

  return { text: text.trim(), usage };
};

export const generateStructuredJsonWithDeepSeek = async <T>(
  input: DeepSeekStructuredJsonInput,
) => {
  const apiKey = getDeepSeekApiKey();

  if (!apiKey) {
    throw new Error("Missing DEEPSEEK_API_KEY.");
  }

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        {
          role: "system",
          content: [
            input.systemInstruction,
            "",
            "Return strict JSON only. The JSON object must match this schema:",
            JSON.stringify(input.jsonSchema),
            ...(input.onReasoningDelta ? ["", STRUCTURED_REASONING_GUIDANCE] : []),
          ].join("\n"),
        },
        {
          role: "user",
          content: input.onReasoningDelta
            ? `${input.prompt}\n\n${STRUCTURED_REASONING_GUIDANCE}`
            : input.prompt,
        },
      ],
      response_format: { type: "json_object" },
      thinking: { type: "enabled" },
      reasoning_effort: input.onReasoningDelta ? "medium" : "max",
      stream: Boolean(input.onReasoningDelta),
      ...(input.onReasoningDelta ? { stream_options: { include_usage: true } } : {}),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DeepSeek structured output failed: ${response.status} ${detail}`);
  }

  if (input.onReasoningDelta) {
    return readDeepSeekStream<T>(response, input.onReasoningDelta);
  }

  const data = (await response.json()) as DeepSeekChatCompletionResponse;
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";

  if (!text) {
    throw new Error("DeepSeek structured output returned no text.");
  }

  return {
    raw: data,
    text,
    data: JSON.parse(text) as T,
    usage: data.usage,
  };
};
