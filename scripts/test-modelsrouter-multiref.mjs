import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// Standalone smoke test for ModelsRouter text-to-image and multi-image
// reference generation. With --ref it hits the OpenAI-compatible image edits
// endpoint with an `image_urls` array of base64 data URIs.
//
// Usage:
//   node scripts/test-modelsrouter-multiref.mjs \
//     --prompt="Blend these two references into one cohesive poster" \
//     --ref=public/media/session_43db6f4e/asset_078b9322.png \
//     --ref=public/media/session_ced69147/asset_e446bf27.png
//
//   # text-to-image baseline (no --ref):
//   node scripts/test-modelsrouter-multiref.mjs --prompt="A watercolor fox in a snowy forest"

const GENERATIONS_URL = "https://api.modelsrouter.cloud/v1/images/generations";
const EDITS_URL = "https://api.modelsrouter.cloud/v1/images/edits";
const API_KEY_FILE = path.join(process.cwd(), "API-Key.txt");

function extractLabeledApiKey(rawValue, labels) {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  const line = rawValue
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => {
      const label = entry.split(/[=:：]/)[0]?.trim().toLowerCase();
      return normalizedLabels.includes(label);
    });

  if (!line) {
    return "";
  }

  return line.replace(/^[^=:：]+[=:：]\s*/, "").trim();
}

function readApiKey() {
  const envKey =
    process.env.MODELSROUTER_API_KEY?.trim() || process.env.BRAINX_API_KEY?.trim();

  if (envKey) {
    return envKey;
  }

  try {
    return extractLabeledApiKey(readFileSync(API_KEY_FILE, "utf8"), [
      "modelsrouter",
      "models router",
      "brainx",
      "brainxai",
    ]);
  } catch {
    return "";
  }
}

function parseArgs() {
  const map = new Map();
  const refs = [];

  for (const arg of process.argv.slice(2)) {
    const [key, ...value] = arg.split("=");
    const name = key.replace(/^--/, "");
    const val = value.join("=") || "true";

    if (name === "ref") {
      refs.push(val);
    } else {
      map.set(name, val);
    }
  }

  return { map, refs };
}

function mimeTypeFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".png":
    default:
      return "image/png";
  }
}

function toDataUri(refPath) {
  if (/^https?:\/\//i.test(refPath) || refPath.startsWith("data:")) {
    return refPath;
  }

  const absolutePath = path.resolve(process.cwd(), refPath);
  const base64 = readFileSync(absolutePath).toString("base64");
  return `data:${mimeTypeFromPath(absolutePath)};base64,${base64}`;
}

async function readResponse(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  const apiKey = readApiKey();

  if (!apiKey) {
    throw new Error(
      "Missing API key. Set MODELSROUTER_API_KEY/BRAINX_API_KEY or add a ModelsRouter:/BrainXai: line to API-Key.txt.",
    );
  }

  const { map, refs } = parseArgs();
  const imageUrls = refs.map(toDataUri);
  const endpoint = imageUrls.length ? EDITS_URL : GENERATIONS_URL;

  const payload = {
    model: map.get("model") ?? "gpt-image-2",
    prompt:
      map.get("prompt") ??
      "Combine the reference images into one cohesive, photorealistic scene.",
    n: Number(map.get("n") ?? 1),
    size: map.get("size") ?? "1024x1024",
    quality: map.get("quality") ?? "high",
    response_format: "b64_json",
    ...(imageUrls.length ? { image_urls: imageUrls } : {}),
  };

  console.log(
    JSON.stringify(
      {
        endpoint,
        model: payload.model,
        prompt: payload.prompt,
        size: payload.size,
        quality: payload.quality,
        referenceCount: imageUrls.length,
        references: refs,
      },
      null,
      2,
    ),
  );

  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const elapsedMs = Date.now() - startedAt;
  const data = await readResponse(response);

  if (!response.ok) {
    console.error(
      JSON.stringify({ status: response.status, elapsedMs, body: data }, null, 2),
    );
    throw new Error(`ModelsRouter request failed: HTTP ${response.status}`);
  }

  const entries = Array.isArray(data?.data) ? data.data : [];
  const summary = entries.map((entry, index) => ({
    index,
    hasB64: Boolean(entry?.b64_json),
    b64Length: entry?.b64_json ? entry.b64_json.length : 0,
    url: entry?.url ?? null,
  }));

  console.log(
    JSON.stringify({ status: response.status, elapsedMs, images: summary }, null, 2),
  );

  // Persist the first image so the result can be eyeballed.
  const first = entries[0];
  if (first?.b64_json) {
    const outPath = path.resolve(
      process.cwd(),
      map.get("out") ?? "modelsrouter-multiref-output.png",
    );
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outPath, Buffer.from(first.b64_json, "base64"));
    console.log(`Saved first image to ${outPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  if (error instanceof Error && error.cause) {
    console.error("cause:", error.cause);
  }
  process.exitCode = 1;
});
