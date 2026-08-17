import {
  classifyGenerationError,
  isRetriable,
} from "@/lib/ai/image-generation/errors";
import { generateImage, type GenerateImageResult } from "@/lib/ai/image-generation";
import {
  getImageProviderAdapter,
  getImageRuntime,
} from "@/lib/ai/image-generation/registry";
import { resolveImageModelSelection, listImageProviders } from "@/lib/ai/image-models";
import type { ImageAsset, GenerationAttempt, GenerationErrorClass } from "@/lib/types";
import type { GenerateImageMode } from "@/lib/ai/image-generation/types";

export type FallbackStrategyKind =
  | "as-is"
  | "drop-weakest-reference"
  | "drop-all-references"
  | "shorten-prompt"
  | "switch-family"
  | "cross-provider";

type FallbackStrategy = {
  kind: FallbackStrategyKind;
  description: string;
  apply: (request: AttemptRequest) => AttemptRequest | null;
};

type AttemptRequest = {
  prompt: string;
  mode: GenerateImageMode;
  providerId: string;
  modelId: string;
  aspectRatio?: string;
  imageSize?: string;
  referenceAssets: ImageAsset[];
};

export type GenerationOutcome =
  | {
      ok: true;
      result: GenerateImageResult;
      providerId: string;
      modelId: string;
      attempts: GenerationAttempt[];
    }
  | {
      ok: false;
      attempts: GenerationAttempt[];
      finalError: { klass: GenerationErrorClass; message: string };
    };

const truncatePrompt = (prompt: string, max = 280) =>
  prompt.length <= max ? prompt : prompt.slice(0, max).trim();

const dropWeakest = (assets: ImageAsset[]) => assets.slice(0, Math.max(0, assets.length - 1));

const findSiblingModel = (currentProviderId: string, currentModelId: string) => {
  const provider = listImageProviders().find((entry) => entry.id === currentProviderId);
  if (!provider) {
    return null;
  }

  const sibling = provider.models.find((model) => model.id !== currentModelId);
  return sibling ?? null;
};

const findAlternateProvider = (currentProviderId: string, currentMode: GenerateImageMode) => {
  for (const provider of listImageProviders()) {
    if (provider.id === currentProviderId) {
      continue;
    }
    const adapter = getImageProviderAdapter(provider.id);
    if (!adapter.isConfigured()) {
      continue;
    }
    const compatibleModel = provider.models.find((model) => {
      const capabilities = model.capabilities;
      if (currentMode === "generate") {
        return capabilities.textToImage;
      }
      return capabilities.imageToImage;
    });
    if (compatibleModel) {
      return { provider, model: compatibleModel };
    }
  }
  return null;
};

const strategies: FallbackStrategy[] = [
  {
    kind: "as-is",
    description: "user-selected provider/model with original references",
    apply: (request) => request,
  },
  {
    kind: "drop-weakest-reference",
    description: "drop the lowest-priority reference image",
    apply: (request) => {
      if (request.referenceAssets.length <= 1) {
        return null;
      }
      return {
        ...request,
        referenceAssets: dropWeakest(request.referenceAssets),
      };
    },
  },
  {
    kind: "drop-all-references",
    description: "retry without any reference image",
    apply: (request) => {
      if (request.referenceAssets.length === 0) {
        return null;
      }
      // Edit mode without references is meaningless; bail and let the next
      // strategy try (switch family) instead.
      if (request.mode === "edit") {
        return null;
      }
      return {
        ...request,
        referenceAssets: [],
      };
    },
  },
  {
    kind: "shorten-prompt",
    description: "truncate the prompt to a shorter form",
    apply: (request) => {
      const shortened = truncatePrompt(request.prompt);
      if (shortened === request.prompt) {
        return null;
      }
      return {
        ...request,
        prompt: shortened,
      };
    },
  },
  {
    kind: "switch-family",
    description: "switch to a sibling model within the same provider",
    apply: (request) => {
      const sibling = findSiblingModel(request.providerId, request.modelId);
      if (!sibling) {
        return null;
      }
      return {
        ...request,
        modelId: sibling.id,
      };
    },
  },
  {
    kind: "cross-provider",
    description: "switch to an alternate provider that supports this mode",
    apply: (request) => {
      const alternate = findAlternateProvider(request.providerId, request.mode);
      if (!alternate) {
        return null;
      }
      return {
        ...request,
        providerId: alternate.provider.id,
        modelId: alternate.model.id,
      };
    },
  },
];

type RunOptions = {
  onAttempt?: (event: { strategy: FallbackStrategyKind; request: AttemptRequest }) => void;
};

export async function generateWithFallback(
  baseRequest: AttemptRequest,
  options: RunOptions = {},
): Promise<GenerationOutcome> {
  const attempts: GenerationAttempt[] = [];
  let lastError: { klass: GenerationErrorClass; message: string } = {
    klass: "unknown",
    message: "No attempt produced a result.",
  };

  let request: AttemptRequest = baseRequest;

  for (const strategy of strategies) {
    const next = strategy.apply(request);
    if (!next) {
      continue;
    }
    request = next;

    options.onAttempt?.({ strategy: strategy.kind, request });

    const startedAt = Date.now();
    try {
      const result = await generateImage({
        prompt: request.prompt,
        mode: request.mode,
        imageProviderId: request.providerId,
        imageModelId: request.modelId,
        aspectRatio: request.aspectRatio,
        imageSize: request.imageSize,
        referenceAssets: request.referenceAssets,
      });

      const durationMs = Date.now() - startedAt;

      const image = result.images[0];
      if (!image || (!image.base64Data && !image.remoteUrl)) {
        throw new Error(`${result.providerName} returned no usable image output.`);
      }

      attempts.push({
        strategy: strategy.kind,
        providerId: request.providerId,
        modelId: request.modelId,
        status: "ok",
        durationMs,
      });

      return {
        ok: true,
        result,
        providerId: request.providerId,
        modelId: request.modelId,
        attempts,
      };
    } catch (error) {
      const classified = classifyGenerationError(error);
      attempts.push({
        strategy: strategy.kind,
        providerId: request.providerId,
        modelId: request.modelId,
        status: "fail",
        durationMs: Date.now() - startedAt,
        errorClass: classified.klass,
        errorMessage: classified.message.slice(0, 240),
      });
      lastError = classified;

      if (!isRetriable(classified.klass)) {
        break;
      }
    }
  }

  return { ok: false, attempts, finalError: lastError };
}

export type FallbackErrorWithAttempts = Error & {
  attempts: GenerationAttempt[];
  errorClass: GenerationErrorClass;
};

export function buildFallbackError(outcome: Extract<GenerationOutcome, { ok: false }>) {
  const err = new Error(outcome.finalError.message) as FallbackErrorWithAttempts;
  err.attempts = outcome.attempts;
  err.errorClass = outcome.finalError.klass;
  return err;
}

export { resolveImageModelSelection, getImageRuntime };
