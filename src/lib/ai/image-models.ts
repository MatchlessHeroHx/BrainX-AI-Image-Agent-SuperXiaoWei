export type ImageProviderId = "google-ai-studio" | "wuyin" | "modelsrouter";

export type ImageModelCapability = {
  textToImage: boolean;
  imageToImage: boolean;
  multiImageReference: boolean;
  maxReferenceImages: number;
  aspectRatios: string[];
  /** Resolution tiers the model exposes (e.g. ["1K","2K","4K"]). Empty when the model has no resolution control. */
  resolutions: string[];
  inputReferenceKind: "inline" | "url" | "url-or-base64";
  outputKind: "inline" | "remote-url";
  executionKind: "sync" | "async";
};

export type ImageModelDefinition = {
  id: string;
  aliases?: string[];
  displayName: string;
  providerId: ImageProviderId;
  providerModel: string;
  capabilities: ImageModelCapability;
};

export type ImageProviderDefinition = {
  id: ImageProviderId;
  displayName: string;
  models: ImageModelDefinition[];
};

export const DEFAULT_IMAGE_PROVIDER_ID: ImageProviderId = "google-ai-studio";
export const DEFAULT_IMAGE_MODEL_ID = "nanobanana2";

const googleAiStudioModels: ImageModelDefinition[] = [
  {
    id: "nanobanana-pro",
    aliases: ["nanobananapro", "nano-banana-pro", "nano banana pro"],
    displayName: "nanobanana pro",
    providerId: "google-ai-studio",
    providerModel: "gemini-3-pro-image-preview",
    capabilities: {
      textToImage: true,
      imageToImage: true,
      multiImageReference: true,
      maxReferenceImages: 3,
      aspectRatios: ["1:1", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9"],
      resolutions: ["1K", "2K", "4K"],
      inputReferenceKind: "inline",
      outputKind: "inline",
      executionKind: "sync",
    },
  },
  {
    id: "nanobanana2",
    aliases: ["nano-banana2", "nano banana 2", "nano-banana-2", "nanobanana-2"],
    displayName: "nanobanana2",
    providerId: "google-ai-studio",
    providerModel: "gemini-3.1-flash-image-preview",
    capabilities: {
      textToImage: true,
      imageToImage: true,
      multiImageReference: true,
      maxReferenceImages: 3,
      aspectRatios: ["1:1", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9"],
      resolutions: ["1K", "2K", "4K"],
      inputReferenceKind: "inline",
      outputKind: "inline",
      executionKind: "sync",
    },
  },
];

const wuyinModels: ImageModelDefinition[] = [
  {
    id: "gpt-image2",
    aliases: [
      "GPT-Image2",
      "GPT Image2",
      "gpt image2",
      "gpt image 2",
      "gpt-image-2",
      "gpt_image_2",
      "image_gpt",
      "gpt-image",
    ],
    displayName: "GPT-Image2",
    providerId: "wuyin",
    providerModel: "image_gpt",
    capabilities: {
      textToImage: true,
      imageToImage: true,
      multiImageReference: true,
      maxReferenceImages: 8,
      aspectRatios: [
        "auto",
        "1:1",
        "3:2",
        "2:3",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "21:9",
        "9:21",
        "1:3",
        "3:1",
        "2:1",
        "1:2",
      ],
      resolutions: [],
      inputReferenceKind: "url",
      outputKind: "remote-url",
      executionKind: "async",
    },
  },
];

const modelsrouterModels: ImageModelDefinition[] = [
  {
    id: "gpt-image-2",
    aliases: [
      "gpt-image2",
      "gpt image 2",
      "gptimage2",
      "gpt_image_2",
      "modelsrouter-gpt-image-2",
    ],
    displayName: "GPT-Image-2 (ModelsRouter)",
    providerId: "modelsrouter",
    providerModel: "gpt-image-2",
    capabilities: {
      // Text-to-image plus reference-driven image editing/generation through
      // ModelsRouter's OpenAI-compatible image edit endpoint.
      textToImage: true,
      imageToImage: true,
      multiImageReference: true,
      maxReferenceImages: 3,
      // Aspect ratios map to OpenAI Images sizes inside the adapter.
      aspectRatios: ["auto", "1:1", "3:2", "2:3"],
      // Resolution tiers map to the OpenAI `quality` parameter inside the adapter.
      resolutions: ["low", "medium", "high"],
      inputReferenceKind: "url-or-base64",
      outputKind: "inline",
      executionKind: "sync",
    },
  },
];

export const IMAGE_PROVIDERS: ImageProviderDefinition[] = [
  {
    id: "google-ai-studio",
    displayName: "Google AI Studio",
    models: googleAiStudioModels,
  },
  {
    id: "wuyin",
    displayName: "五音科技 / 速创 API",
    models: wuyinModels,
  },
  {
    id: "modelsrouter",
    displayName: "ModelsRouter",
    models: modelsrouterModels,
  },
];

const providerById = new Map(IMAGE_PROVIDERS.map((provider) => [provider.id, provider]));

const normalizeImageModelKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const modelKeys = (model: ImageModelDefinition) =>
  [model.id, model.providerModel, ...(model.aliases ?? [])].map(normalizeImageModelKey);

const imageModelByProviderKey = new Map(
  IMAGE_PROVIDERS.flatMap((provider) =>
    provider.models.flatMap((model) =>
      modelKeys(model).map((key) => [`${provider.id}:${key}`, model] as const),
    ),
  ),
);
const imageModelByGlobalKey = new Map(
  IMAGE_PROVIDERS.flatMap((provider) =>
    provider.models.flatMap((model) =>
      modelKeys(model).map((key) => [key, { provider, model }] as const),
    ),
  ),
);

export function listImageProviders() {
  return IMAGE_PROVIDERS;
}

export function resolveImageModelSelection(params: {
  providerId?: string;
  modelId?: string;
}) {
  const fallbackProvider = providerById.get(DEFAULT_IMAGE_PROVIDER_ID);

  if (!fallbackProvider) {
    throw new Error(`Default image provider is not registered: ${DEFAULT_IMAGE_PROVIDER_ID}`);
  }

  const providerId = params.providerId?.trim();
  const modelId = params.modelId?.trim();
  const explicitProvider = providerId
    ? providerById.get(providerId as ImageProviderId)
    : undefined;

  if (providerId && !explicitProvider) {
    throw new Error(`Image provider is not registered: ${providerId}`);
  }

  if (modelId) {
    const normalizedModelId = normalizeImageModelKey(modelId);

    if (explicitProvider) {
      const model = imageModelByProviderKey.get(`${explicitProvider.id}:${normalizedModelId}`);

      if (!model) {
        throw new Error(
          `Image model is not registered for ${explicitProvider.displayName}: ${modelId}`,
        );
      }

      return {
        provider: explicitProvider,
        model,
      };
    }

    const globalModel = imageModelByGlobalKey.get(normalizedModelId);

    if (!globalModel) {
      throw new Error(`Image model is not registered: ${modelId}`);
    }

    return globalModel;
  }

  const provider = explicitProvider ?? fallbackProvider;
  const fallbackModelId =
    provider.id === DEFAULT_IMAGE_PROVIDER_ID
      ? DEFAULT_IMAGE_MODEL_ID
      : provider.models[0]?.id;
  const model =
    (fallbackModelId
      ? imageModelByProviderKey.get(`${provider.id}:${normalizeImageModelKey(fallbackModelId)}`)
      : undefined) ?? provider.models[0];

  if (!model) {
    throw new Error(`No image models registered for provider: ${provider.id}`);
  }

  return {
    provider,
    model,
  };
}

export function getConfiguredImageModelSelection() {
  return resolveImageModelSelection({
    providerId: process.env.IMAGE_PROVIDER ?? process.env.IMAGE_MODEL_PROVIDER,
    modelId: process.env.IMAGE_MODEL ?? process.env.GEMINI_IMAGE_MODEL,
  });
}
