import {
  ensureSystemPromptCache,
  generateStructuredJsonWithGemini,
  getGeminiApiKey,
  getGeminiPerceptionModel,
  type GeminiPart,
} from "@/lib/ai/google-ai";
import { materializeInlineReferences } from "@/lib/ai/image-generation/reference-materializer";
import type { ImageAsset, ImageObservation } from "@/lib/types";

const OBSERVATION_SYSTEM_PROMPT = [
  "You are an image perception module. Given a single image, extract structured visual facts only.",
  "Be terse, concrete, and avoid speculation. Use natural English phrases (not keyword lists) for free-text fields.",
  "Also provide `captionZh` as 2-4 concise Simplified Chinese sentences for direct user-facing image description.",
  "If the image contains rendered text or a logo, extract them verbatim when legible.",
  "Output strict JSON matching the response schema.",
].join("\n");

const observationSchema = {
  type: "object",
  properties: {
    mainSubject: {
      type: "string",
      description: "1-2 sentence description of the central subject(s) and what they're doing.",
    },
    style: {
      type: "string",
      description: "Short phrase: e.g. 'soft natural light, lifestyle photography' or 'flat vector illustration'.",
    },
    dominantColors: {
      type: "array",
      items: { type: "string" },
      description: "1-5 color names that read first, in natural language (e.g. 'warm beige', 'muted teal').",
    },
    containsText: {
      type: "boolean",
      description: "True if the image contains any rendered text or typography.",
    },
    captionZh: {
      type: "string",
      description: "2-4 concise Simplified Chinese sentences describing visible image content, composition, lighting, color, and any legible text or logo.",
    },
    ocrText: {
      type: "string",
      description: "Verbatim transcription of any rendered text. Empty string if none.",
    },
    hasLogo: {
      type: "boolean",
      description: "True if a brand logo or wordmark is visible.",
    },
    compositionHint: {
      type: "string",
      description: "Optional 1-clause hint about composition (e.g. 'center-weighted, shallow DoF').",
    },
    referenceDimensions: {
      type: "array",
      items: { type: "string" },
      description:
        "1-5 dimensions that could be reused in a new image, such as palette, composition, lighting, material, style, or subject silhouette.",
    },
    editableRegions: {
      type: "array",
      items: { type: "string" },
      description:
        "1-6 concrete visible regions or layers that an editor could target, such as product body, background, typography, clothing, or lighting.",
    },
  },
  required: ["mainSubject", "style", "dominantColors", "containsText", "hasLogo"],
} satisfies Record<string, unknown>;

type ObservationLLMResponse = {
  mainSubject?: string;
  style?: string;
  dominantColors?: string[];
  containsText?: boolean;
  captionZh?: string;
  ocrText?: string;
  hasLogo?: boolean;
  compositionHint?: string;
  referenceDimensions?: string[];
  editableRegions?: string[];
};

/**
 * Call Gemini vision on a single image to produce structured observations.
 * Returns null when the API key is missing, the image cannot be loaded, or the
 * call fails. Callers should treat null as "no observations yet"; the rest of
 * the system continues to work using the existing label/focus strings.
 */
export async function captureAssetObservations(
  asset: ImageAsset,
): Promise<ImageObservation | null> {
  if (!getGeminiApiKey()) {
    return null;
  }

  // SVG fallback previews carry no real visual information.
  if (asset.mimeType === "image/svg+xml") {
    return null;
  }

  try {
    const [reference] = await materializeInlineReferences([asset]);
    if (!reference) {
      return null;
    }

    const model = getGeminiPerceptionModel();
    const cachedContent = await ensureSystemPromptCache({
      systemText: OBSERVATION_SYSTEM_PROMPT,
      model,
    });

    const parts: GeminiPart[] = [
      {
        text: "Analyze this image and return observations as JSON.",
      },
      {
        inlineData: {
          mimeType: reference.mimeType,
          data: reference.base64Data,
        },
      },
    ];

    const result = await generateStructuredJsonWithGemini<ObservationLLMResponse>({
      model,
      parts,
      jsonSchema: observationSchema,
      systemInstruction: cachedContent ? undefined : OBSERVATION_SYSTEM_PROMPT,
      cachedContent: cachedContent ?? undefined,
    });

    const data = result.data;
    const observation: ImageObservation = {
      mainSubject: (data.mainSubject ?? "").trim(),
      style: (data.style ?? "").trim(),
      dominantColors: Array.isArray(data.dominantColors)
        ? data.dominantColors
            .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
            .map((entry) => entry.trim())
            .slice(0, 5)
        : [],
      containsText: Boolean(data.containsText),
      hasLogo: Boolean(data.hasLogo),
      capturedAt: new Date().toISOString(),
    };

    if (data.ocrText && data.ocrText.trim()) {
      observation.ocrText = data.ocrText.trim();
    }
    if (data.captionZh && data.captionZh.trim()) {
      observation.captionZh = data.captionZh.trim();
    }
    if (data.compositionHint && data.compositionHint.trim()) {
      observation.compositionHint = data.compositionHint.trim();
    }
    if (Array.isArray(data.referenceDimensions)) {
      observation.referenceDimensions = data.referenceDimensions
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim())
        .slice(0, 5);
    }
    if (Array.isArray(data.editableRegions)) {
      observation.editableRegions = data.editableRegions
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim())
        .slice(0, 6);
    }

    if (!observation.mainSubject && !observation.style && !observation.dominantColors.length) {
      // Empty perception — don't persist a no-op record.
      return null;
    }

    return observation;
  } catch (error) {
    console.warn("[image-agent] perception failed", {
      assetId: asset.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
