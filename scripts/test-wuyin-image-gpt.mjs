import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const API_URL = "https://api.wuyinkeji.com/api/async/image_gpt";
const DETAIL_URL = "https://api.wuyinkeji.com/api/async/detail";
const API_KEY_FILE = path.join(process.cwd(), "suchuang-API-Key.txt");

function readApiKey() {
  const envKey = process.env.WUYIN_API_KEY?.trim() || process.env.SUCHUANG_API_KEY?.trim();

  if (envKey) {
    return envKey;
  }

  try {
    return readFileSync(API_KEY_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

function parseArgs() {
  return new Map(
    process.argv.slice(2).map((arg) => {
      const [key, ...value] = arg.split("=");
      return [key.replace(/^--/, ""), value.join("=") || "true"];
    }),
  );
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

function parseReferenceUrls(args) {
  const urls = [];
  const refUrl = args.get("refUrl");
  const refFile = args.get("refFile");

  if (refUrl) {
    urls.push(refUrl);
  }

  if (refFile) {
    const absolutePath = path.resolve(process.cwd(), refFile);
    const base64 = readFileSync(absolutePath).toString("base64");
    const refEncoding = args.get("refEncoding") ?? "data-url";

    urls.push(
      refEncoding === "raw-base64"
        ? base64
        : `data:${mimeTypeFromPath(absolutePath)};base64,${base64}`,
    );
  }

  return urls;
}

async function main() {
  const apiKey = readApiKey();

  if (!apiKey) {
    throw new Error(
      "Missing API key. Set WUYIN_API_KEY/SUCHUANG_API_KEY or create suchuang-API-Key.txt in the project root.",
    );
  }

  const args = parseArgs();

  const taskId = args.get("id") || (await createImageTask(apiKey, args));
  const poll = args.get("poll") !== "false";

  if (!poll) {
    return;
  }

  const attempts = Number(args.get("attempts") ?? 30);
  const intervalMs = Number(args.get("intervalMs") ?? 5_000);

  await pollImageTask(apiKey, taskId, attempts, intervalMs);
}

async function createImageTask(apiKey, args) {
  const url = new URL(API_URL);
  url.searchParams.set("key", apiKey);
  const referenceUrls = parseReferenceUrls(args);
  const payload = {
    prompt:
      args.get("prompt") ??
      "一张小狗的真实照片，阳光下坐在草地上，清晰自然，摄影风格",
    size: args.get("size") ?? "1:1",
    ...(referenceUrls.length ? { urls: referenceUrls } : {}),
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await readResponse(response);

  if (!response.ok) {
    console.error(JSON.stringify({ status: response.status, body: data }, null, 2));
    throw new Error("Create image task failed.");
  }

  console.log(JSON.stringify(data, null, 2));

  const taskId = data?.data?.id;

  if (!taskId) {
    throw new Error("Create image task response did not include data.id.");
  }

  return taskId;
}

async function pollImageTask(apiKey, taskId, attempts, intervalMs) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const detail = await fetchImageTaskDetail(apiKey, taskId);
    console.log(
      JSON.stringify(
        {
          attempt,
          id: taskId,
          detail,
        },
        null,
        2,
      ),
    );

    const status = detail?.data?.status;
    if (status === 2 || status === 3) {
      return;
    }

    if (attempt < attempts) {
      await wait(intervalMs);
    }
  }

  throw new Error(`Timed out waiting for image task ${taskId}.`);
}

async function fetchImageTaskDetail(apiKey, taskId) {
  const url = new URL(DETAIL_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("id", taskId);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
  });

  const data = await readResponse(response);

  if (!response.ok) {
    console.error(JSON.stringify({ status: response.status, body: data }, null, 2));
    throw new Error("Fetch image task detail failed.");
  }

  return data;
}

async function readResponse(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
