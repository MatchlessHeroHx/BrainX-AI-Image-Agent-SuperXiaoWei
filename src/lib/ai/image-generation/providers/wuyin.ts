import { readFileSync } from "node:fs";
import path from "node:path";
import { materializeUrlReferences } from "@/lib/ai/image-generation/reference-materializer";
import type {
  ImageProviderAdapter,
  ImageProviderGenerateInput,
} from "@/lib/ai/image-generation/types";

const WUYIN_IMAGE_GPT_URL = "https://api.wuyinkeji.com/api/async/image_gpt";
const WUYIN_DETAIL_URL = "https://api.wuyinkeji.com/api/async/detail";
const WUYIN_API_KEY_FILE = path.join(process.cwd(), "suchuang-API-Key.txt");
const GENERIC_API_KEY_FILE = path.join(process.cwd(), "API-Key.txt");
const DEFAULT_ATTEMPTS = 36;
const DEFAULT_INTERVAL_MS = 5_000;

type WuyinCreateResponse = {
  code?: number;
  msg?: string;
  data?: {
    id?: string;
  } | null;
};

type WuyinDetailResponse = {
  code?: number;
  msg?: string;
  data?: {
    status?: number;
    result?: string[] | null;
    message?: string;
  } | null;
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

const readApiKeyFile = (filePath: string) => {
  try {
    return readFileSync(filePath, "utf8").trim() || null;
  } catch {
    return null;
  }
};

function getWuyinApiKey() {
  const envKey = process.env.WUYIN_API_KEY?.trim() || process.env.SUCHUANG_API_KEY?.trim();

  if (envKey) {
    return envKey;
  }

  return (
    readApiKeyFile(WUYIN_API_KEY_FILE) ||
    extractLabeledApiKey(readApiKeyFile(GENERIC_API_KEY_FILE) ?? "", [
      "wuyin",
      "suchuang",
      "shchuang",
      "五音",
      "速创",
    ])
  );
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Wuyin API returned non-JSON response: ${text.slice(0, 200)}`);
  }
}

function assertWuyinSuccess(response: { code?: number; msg?: string }, operation: string) {
  if (response.code !== 200) {
    throw new Error(`Wuyin ${operation} failed: ${response.code ?? "unknown"} ${response.msg ?? ""}`);
  }
}

async function createTask(input: ImageProviderGenerateInput, apiKey: string) {
  const url = new URL(WUYIN_IMAGE_GPT_URL);
  url.searchParams.set("key", apiKey);

  const referenceUrls = materializeUrlReferences(
    input.referenceAssets.slice(0, input.model.capabilities.maxReferenceImages),
  ).map((reference) => reference.url);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: input.prompt,
      size: input.aspectRatio ?? "auto",
      ...(referenceUrls.length ? { urls: referenceUrls } : {}),
    }),
    cache: "no-store",
  });

  const data = await readJsonResponse<WuyinCreateResponse>(response);

  if (!response.ok) {
    throw new Error(`Wuyin create task failed: ${response.status} ${data.msg ?? ""}`);
  }

  assertWuyinSuccess(data, "create task");

  if (!data.data?.id) {
    throw new Error("Wuyin create task response did not include data.id.");
  }

  return {
    id: data.data.id,
    raw: data,
  };
}

async function fetchTaskDetail(taskId: string, apiKey: string) {
  const url = new URL(WUYIN_DETAIL_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("id", taskId);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  const data = await readJsonResponse<WuyinDetailResponse>(response);

  if (!response.ok) {
    throw new Error(`Wuyin detail failed: ${response.status} ${data.msg ?? ""}`);
  }

  assertWuyinSuccess(data, "detail");
  return data;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollTask(taskId: string, apiKey: string) {
  let latest: WuyinDetailResponse | null = null;

  for (let attempt = 1; attempt <= DEFAULT_ATTEMPTS; attempt += 1) {
    latest = await fetchTaskDetail(taskId, apiKey);
    const status = latest.data?.status;

    if (status === 2) {
      const results = latest.data?.result ?? [];

      if (!results.length) {
        throw new Error("Wuyin task succeeded but returned no image URLs.");
      }

      return latest;
    }

    if (status === 3) {
      throw new Error(`Wuyin task failed: ${latest.data?.message || latest.msg || taskId}`);
    }

    if (attempt < DEFAULT_ATTEMPTS) {
      await wait(DEFAULT_INTERVAL_MS);
    }
  }

  throw new Error(`Timed out waiting for Wuyin image task ${taskId}.`);
}

export const wuyinImageProvider: ImageProviderAdapter = {
  id: "wuyin",
  displayName: "五音科技 / 速创 API",
  isConfigured: () => Boolean(getWuyinApiKey()),
  async generate(input: ImageProviderGenerateInput) {
    const apiKey = getWuyinApiKey();

    if (!apiKey) {
      throw new Error("Missing WUYIN_API_KEY or SUCHUANG_API_KEY.");
    }

    const task = await createTask(input, apiKey);
    const detail = await pollTask(task.id, apiKey);

    return {
      raw: {
        create: task.raw,
        detail,
      },
      images: (detail.data?.result ?? []).map((remoteUrl) => ({
        remoteUrl,
      })),
    };
  },
};
