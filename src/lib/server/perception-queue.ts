import { captureAssetObservations } from "@/lib/agent/perception";
import { buildAssetSemanticSummary } from "@/lib/server/context-memory";
import { mutateStore } from "@/lib/server/store";
import type { ImageAsset } from "@/lib/types";

type QueueJob = {
  conversationId: string;
  assetId: string;
};

const pendingJobs = new Map<string, Promise<void>>();

/**
 * Schedule a vision-perception pass for an uploaded asset. Fire-and-forget:
 * the function returns immediately, and the observation is written back to
 * `store.json` whenever the LLM call finishes. If the API key is missing or
 * the call fails, the asset is simply left without observations (the rest of
 * the system still works on label/focus strings).
 *
 * De-dupes by assetId — calling this multiple times for the same asset only
 * triggers one inflight call.
 */
export function schedulePerception(job: QueueJob) {
  if (pendingJobs.has(job.assetId)) {
    return;
  }

  const work = runPerceptionJob(job)
    .catch((error) => {
      console.warn("[image-agent] perception job failed", {
        assetId: job.assetId,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      pendingJobs.delete(job.assetId);
    });

  pendingJobs.set(job.assetId, work);
}

/**
 * Test-only / debug helper: wait until all scheduled perception jobs settle.
 * Production code paths never call this.
 */
export async function flushPerceptionQueue() {
  while (pendingJobs.size) {
    await Promise.allSettled(Array.from(pendingJobs.values()));
  }
}

async function runPerceptionJob(job: QueueJob): Promise<void> {
  // Snapshot the asset before the slow LLM call so we can pass a stable copy.
  let assetSnapshot: ImageAsset | null = null;
  await mutateStore(async (store) => {
    const conversation = store.conversations.find((entry) => entry.id === job.conversationId);
    if (!conversation) {
      return;
    }
    const asset = conversation.assets.find((entry) => entry.id === job.assetId);
    if (asset && !asset.observations) {
      assetSnapshot = { ...asset };
    }
  });

  if (!assetSnapshot) {
    return;
  }

  const observation = await captureAssetObservations(assetSnapshot);
  if (!observation) {
    return;
  }

  await mutateStore(async (store) => {
    const conversation = store.conversations.find((entry) => entry.id === job.conversationId);
    if (!conversation) {
      return;
    }
    const asset = conversation.assets.find((entry) => entry.id === job.assetId);
    if (asset && !asset.observations) {
      asset.observations = observation;
      asset.semanticSummary = buildAssetSemanticSummary(asset, observation);
    }
  });
}
