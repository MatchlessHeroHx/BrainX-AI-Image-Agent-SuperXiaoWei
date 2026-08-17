import { getImageRuntime } from "@/lib/ai/image-generation/registry";
import type {
  GenerateImageMode,
  ImageProviderGenerateResult,
} from "@/lib/ai/image-generation/types";
import type { ImageAsset } from "@/lib/types";

export type GenerateImageInput = {
  prompt: string;
  mode: GenerateImageMode;
  aspectRatio?: string;
  imageSize?: string;
  imageProviderId?: string;
  imageModelId?: string;
  referenceAssets: ImageAsset[];
};

export type GenerateImageResult = ImageProviderGenerateResult & {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
};

export async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
  const runtime = getImageRuntime({
    providerId: input.imageProviderId,
    modelId: input.imageModelId,
  });
  const result = await runtime.adapter.generate({
    prompt: input.prompt,
    mode: input.mode,
    model: runtime.model,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    referenceAssets: input.referenceAssets,
  });

  return {
    ...result,
    providerId: runtime.provider.id,
    providerName: runtime.provider.displayName,
    modelId: runtime.model.id,
    modelName: runtime.model.displayName,
  };
}

export { getRuntimeConfig } from "@/lib/ai/image-generation/registry";
export type { InlineReferenceImage } from "@/lib/ai/image-generation/types";
