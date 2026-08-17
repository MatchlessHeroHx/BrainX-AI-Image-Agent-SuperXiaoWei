import type { ImageModelDefinition, ImageProviderDefinition } from "@/lib/ai/image-models";
import type { ImageAsset, PlannerAction } from "@/lib/types";

export type InlineReferenceImage = {
  mimeType: string;
  base64Data: string;
};

export type UrlReferenceImage = {
  url: string;
};

export type ProviderReferenceImage = InlineReferenceImage | UrlReferenceImage;

export type GenerateImageMode = Exclude<PlannerAction, "discuss" | "clarify">;

export type ImageProviderGenerateInput = {
  prompt: string;
  mode: GenerateImageMode;
  model: ImageModelDefinition;
  aspectRatio?: string;
  /** Resolution tier (e.g. "1K" | "2K" | "4K"). Providers without a resolution control ignore it. */
  imageSize?: string;
  referenceAssets: ImageAsset[];
};

export type GeneratedProviderImage = {
  mimeType?: string;
  base64Data?: string;
  remoteUrl?: string;
};

export type ImageProviderGenerateResult = {
  images: GeneratedProviderImage[];
  raw?: unknown;
};

export type ImageProviderAdapter = {
  id: ImageProviderDefinition["id"];
  displayName: string;
  isConfigured: () => boolean;
  generate: (input: ImageProviderGenerateInput) => Promise<ImageProviderGenerateResult>;
};
