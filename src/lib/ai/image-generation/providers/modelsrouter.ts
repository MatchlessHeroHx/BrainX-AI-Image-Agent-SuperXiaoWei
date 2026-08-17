import { readFileSync } from "node:fs";
import path from "node:path";
import { materializeInlineReferences } from "@/lib/ai/image-generation/reference-materializer";
import type {
  ImageProviderAdapter,
  ImageProviderGenerateInput,
} from "@/lib/ai/image-generation/types";

const MODELSROUTER_GENERATIONS_URL =
  "https://api.modelsrouter.cloud/v1/images/generations";
const MODELSROUTER_EDITS_URL = "https://api.modelsrouter.cloud/v1/images/edits";
const GENERIC_API_KEY_FILE = path.join(process.cwd(), "API-Key.txt");

// Map our aspect-ratio chips to OpenAI Images `size` values.
const SIZE_BY_ASPECT_RATIO: Record<string, string> = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

type ModelsRouterImageResponse = {
  created?: number;
  data?: Array<{ b64_json?: string; url?: string }> | null;
  error?: { message?: string } | string | null;
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

function getModelsRouterApiKey() {
  const envKey =
    process.env.MODELSROUTER_API_KEY?.trim() || process.env.BRAINX_API_KEY?.trim();

  if (envKey) {
    return envKey;
  }

  return extractLabeledApiKey(readApiKeyFile(GENERIC_API_KEY_FILE) ?? "", [
    "modelsrouter",
    "models router",
    "brainx",
    "brainxai",
  ]);
}

function resolveSize(aspectRatio?: string) {
  if (!aspectRatio || aspectRatio === "auto") {
    return "auto";
  }

  return SIZE_BY_ASPECT_RATIO[aspectRatio] ?? "auto";
}

function resolveQuality(imageSize?: string) {
  const quality = imageSize?.trim().toLowerCase();

  if (quality === "low" || quality === "medium" || quality === "high") {
    return quality;
  }

  return "auto";
}

function extractErrorMessage(data: ModelsRouterImageResponse, fallback: string) {
  if (typeof data.error === "string") {
    return data.error;
  }

  return data.error?.message || fallback;
}

export const modelsrouterImageProvider: ImageProviderAdapter = {
  id: "modelsrouter",
  displayName: "ModelsRouter",
  isConfigured: () => Boolean(getModelsRouterApiKey()),
  async generate(input: ImageProviderGenerateInput) {
    const apiKey = getModelsRouterApiKey();

    if (!apiKey) {
      throw new Error("Missing MODELSROUTER_API_KEY or BRAINX_API_KEY.");
    }

    // Reference generation/editing uses the OpenAI-compatible edits endpoint.
    // ModelsRouter accepts data URIs in `image_urls`, so local /media assets do
    // not need to be uploaded to a public URL first.
    const references = await materializeInlineReferences(
      input.referenceAssets.slice(0, input.model.capabilities.maxReferenceImages),
    );
    const imageUrls = references.map(
      (reference) => `data:${reference.mimeType};base64,${reference.base64Data}`,
    );
    const endpoint = imageUrls.length
      ? MODELSROUTER_EDITS_URL
      : MODELSROUTER_GENERATIONS_URL;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model.providerModel,
        prompt: input.prompt,
        n: 1,
        size: resolveSize(input.aspectRatio),
        quality: resolveQuality(input.imageSize),
        response_format: "b64_json",
        ...(imageUrls.length ? { image_urls: imageUrls } : {}),
      }),
      cache: "no-store",
    });

    const text = await response.text();
    let data: ModelsRouterImageResponse;

    try {
      data = JSON.parse(text) as ModelsRouterImageResponse;
    } catch {
      throw new Error(
        `ModelsRouter returned non-JSON response: ${text.slice(0, 200)}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `ModelsRouter image generation failed: ${response.status} ${extractErrorMessage(data, text.slice(0, 200))}`,
      );
    }

    const entries = data.data ?? [];

    if (!entries.length) {
      throw new Error("ModelsRouter response did not include any images.");
    }

    return {
      raw: data,
      images: entries
        .map((entry) => {
          if (entry.b64_json) {
            return { mimeType: "image/png", base64Data: entry.b64_json };
          }

          if (entry.url) {
            return { remoteUrl: entry.url };
          }

          return null;
        })
        .filter((image): image is NonNullable<typeof image> => image !== null),
    };
  },
};
