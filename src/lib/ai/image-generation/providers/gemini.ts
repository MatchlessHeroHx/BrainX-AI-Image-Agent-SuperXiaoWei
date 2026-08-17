import {
  buildImageRequestPayload,
  extractBase64Images,
  getGeminiApiKey,
} from "@/lib/ai/google-ai";
import { materializeInlineReferences } from "@/lib/ai/image-generation/reference-materializer";
import type {
  ImageProviderAdapter,
  ImageProviderGenerateInput,
} from "@/lib/ai/image-generation/types";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export const geminiImageProvider: ImageProviderAdapter = {
  id: "google-ai-studio",
  displayName: "Google AI Studio",
  isConfigured: () => Boolean(getGeminiApiKey()),
  async generate(input: ImageProviderGenerateInput) {
    const apiKey = getGeminiApiKey();

    if (!apiKey) {
      throw new Error("Missing GEMINI_API_KEY or GOOGLE_API_KEY.");
    }

    const references = await materializeInlineReferences(
      input.referenceAssets.slice(0, input.model.capabilities.maxReferenceImages),
    );
    const response = await fetch(
      `${GEMINI_BASE_URL}/models/${input.model.providerModel}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(
          buildImageRequestPayload({
            prompt: input.prompt,
            aspectRatio: input.aspectRatio as
              | "1:1"
              | "3:4"
              | "4:3"
              | "4:5"
              | "5:4"
              | "9:16"
              | "16:9"
              | undefined,
            imageSize: input.imageSize,
            references,
          }),
        ),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Gemini image generation failed: ${response.status} ${detail}`);
    }

    const data = await response.json();

    return {
      raw: data,
      images: extractBase64Images(data).map((image) => ({
        mimeType: image.mimeType,
        base64Data: image.base64Data,
      })),
    };
  },
};
