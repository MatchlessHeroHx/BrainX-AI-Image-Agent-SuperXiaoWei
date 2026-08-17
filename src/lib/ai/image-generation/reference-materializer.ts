import { promises as fs } from "node:fs";
import path from "node:path";
import type { ImageAsset } from "@/lib/types";
import type { InlineReferenceImage, UrlReferenceImage } from "@/lib/ai/image-generation/types";

const parseDataUrl = (input: string): InlineReferenceImage | null => {
  const match = /^data:([^;,]+)(;charset=[^;,]+)?(;base64)?,([\s\S]*)$/.exec(input);

  if (!match) {
    return null;
  }

  const [, mimeType, , base64Flag, payload] = match;

  return {
    mimeType,
    base64Data: base64Flag
      ? payload
      : Buffer.from(decodeURIComponent(payload), "utf8").toString("base64"),
  };
};

const getAssetFilePath = (asset: ImageAsset) =>
  path.join(process.cwd(), "public", asset.url.replace(/^\//, ""));

const isAbsoluteHttpUrl = (value: string) => /^https?:\/\//i.test(value);

export async function materializeInlineReferences(
  assets: ImageAsset[],
): Promise<InlineReferenceImage[]> {
  const references: InlineReferenceImage[] = [];

  for (const asset of assets) {
    const inlineFromDataUrl = parseDataUrl(asset.url);

    if (inlineFromDataUrl) {
      references.push(inlineFromDataUrl);
      continue;
    }

    if (isAbsoluteHttpUrl(asset.url)) {
      const response = await fetch(asset.url, { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`Failed to download remote reference image: ${response.status}`);
      }

      references.push({
        mimeType: response.headers.get("content-type")?.split(";")[0] || asset.mimeType,
        base64Data: Buffer.from(await response.arrayBuffer()).toString("base64"),
      });
      continue;
    }

    const buffer = await fs.readFile(getAssetFilePath(asset));
    references.push({
      mimeType: asset.mimeType,
      base64Data: buffer.toString("base64"),
    });
  }

  return references;
}

export function materializeUrlReferences(assets: ImageAsset[]): UrlReferenceImage[] {
  return assets.map((asset) => {
    if (asset.externalUrl && isAbsoluteHttpUrl(asset.externalUrl)) {
      return { url: asset.externalUrl };
    }

    if (isAbsoluteHttpUrl(asset.url)) {
      return { url: asset.url };
    }

    throw new Error(
      "The selected image model requires public reference image URLs. Local /media reference assets are not supported for this provider yet.",
    );
  });
}
