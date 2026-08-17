import type { ImageAsset, PersistedConversation } from "@/lib/types";

const unique = <T>(items: T[]) => Array.from(new Set(items));

export type ResolvedReferenceContext = {
  assetIds: string[];
  inferredAssetIds: string[];
  resolutionNote?: string;
  hardReset: boolean;
};

/**
 * Reference resolution is the Agent's job, not a regex's.
 *
 * This used to scan the user's text with keyword/stop-word/semantic-scoring
 * heuristics to *guess* which historical image the user meant ("上一张",
 * "原图", "第三版", fuzzy term matching, ...). That was fragile: any phrasing
 * the patterns didn't anticipate (e.g. "你刚生成的图片") silently resolved to
 * nothing and dead-ended the turn — and worse, the guess was then fed to the
 * LLM as a pre-decided "inferred reference", biasing a model that is perfectly
 * capable of reading the conversation's asset catalog and timeline itself.
 *
 * So we no longer parse intent from text here. The LLM planner owns reference
 * selection: it sees every asset (id, label, focus, observations, source
 * request) plus the actual pixels of the most recent images, and emits
 * `referenceAssetIds` directly. Those IDs are validated against real assets in
 * `normalizePlannerOutput`, which is the only guard we need against
 * hallucination. The offline heuristic planner (used only when no LLM is
 * configured) resolves common pronouns on its own from recency.
 *
 * This function now only passes through references the *caller* already
 * resolved structurally (e.g. an image the user clicked in the UI). It makes no
 * judgment from the message text.
 */
export function resolveReferenceContext(params: {
  conversation: PersistedConversation;
  userText: string;
  uploadedAssets: ImageAsset[];
  explicitReferenceAssetIds: string[];
}): ResolvedReferenceContext {
  const explicitIds = unique(params.explicitReferenceAssetIds).slice(0, 3);

  return {
    assetIds: explicitIds,
    inferredAssetIds: [],
    resolutionNote: undefined,
    hardReset: false,
  };
}
