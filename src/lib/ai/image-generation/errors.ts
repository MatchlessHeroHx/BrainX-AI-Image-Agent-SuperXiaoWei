import type { GenerationErrorClass } from "@/lib/types";

const matchersByClass: Array<{ klass: GenerationErrorClass; patterns: RegExp[] }> = [
  {
    klass: "reference_rejected",
    patterns: [
      /image upload failed/i,
      /reference image (was )?rejected/i,
      /url is not allowed/i,
      /unsupported image (format|kind)/i,
      /could not (read|fetch) reference/i,
      /reference materializer requires/i,
    ],
  },
  {
    klass: "reference_too_many",
    patterns: [/too many reference/i, /max reference images/i],
  },
  {
    klass: "prompt_too_long",
    patterns: [/prompt (is )?too long/i, /prompt length/i, /max(imum)? prompt/i],
  },
  {
    klass: "provider_quota",
    patterns: [/quota/i, /rate limit/i, /429/, /resource[_ -]exhausted/i],
  },
  {
    klass: "provider_outage",
    patterns: [/timed? out/i, /503/, /500/, /504/, /unavailable/i, /failed to fetch/i],
  },
  {
    klass: "network",
    patterns: [/fetch failed/i, /econnrefused/i, /etimedout/i, /enotfound/i],
  },
  {
    klass: "config",
    patterns: [/missing .* api[_ -]?key/i, /not configured/i, /no api key/i],
  },
];

export function classifyGenerationError(error: unknown): {
  klass: GenerationErrorClass;
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error ?? "");

  for (const matcher of matchersByClass) {
    for (const pattern of matcher.patterns) {
      if (pattern.test(message)) {
        return { klass: matcher.klass, message };
      }
    }
  }

  return { klass: "unknown", message };
}

/**
 * Retriable error classes worth attempting a fallback strategy for.
 * Config errors and "too many" errors are not retriable as-is — they need a
 * different strategy (different provider, fewer refs).
 */
export function isRetriable(klass: GenerationErrorClass) {
  return klass !== "config";
}
