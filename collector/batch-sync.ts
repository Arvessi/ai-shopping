import { syncCollectorStore } from "./orchestrator.ts";
import type { CollectorSourceHandlers, StoreSyncResult } from "./orchestrator.ts";
import type { CollectorSourceKind, CollectorStore } from "./types.ts";

export type BatchSyncSummary = {
  stores: number;
  storesWithOffers: number;
  storesWithoutOffers: number;
  totalOffers: number;
  selectedBySource: Record<CollectorSourceKind, number>;
  fellThroughToDiscovery: number;
  failedStores: string[];
};

export type BatchSyncResult = {
  results: StoreSyncResult[];
  summary: BatchSyncSummary;
};

export async function syncCollectorStores(
  stores: CollectorStore[],
  handlers: CollectorSourceHandlers,
): Promise<BatchSyncResult> {
  const results: StoreSyncResult[] = [];

  // Sequential on purpose for the first production version: it avoids a burst
  // of merchant traffic and, most importantly, prevents accidental bursts of
  // paid discovery calls. We can add bounded concurrency per source later.
  for (const store of stores) {
    results.push(await syncCollectorStore(store, handlers));
  }

  const selectedBySource: Record<CollectorSourceKind, number> = {
    "merchant-feed": 0,
    sitemap: 0,
    "catalog-adapter": 0,
    "discovery-fallback": 0,
  };

  for (const result of results) {
    if (result.selectedSource) selectedBySource[result.selectedSource] += 1;
  }

  const storesWithOffers = results.filter((result) => result.offers.length > 0).length;
  const fellThroughToDiscovery = results.filter((result) =>
    result.attempts.some((attempt) => attempt.source === "discovery-fallback" && attempt.status !== "unavailable"),
  ).length;

  return {
    results,
    summary: {
      stores: results.length,
      storesWithOffers,
      storesWithoutOffers: results.length - storesWithOffers,
      totalOffers: results.reduce((sum, result) => sum + result.offers.length, 0),
      selectedBySource,
      fellThroughToDiscovery,
      failedStores: results.filter((result) => result.offers.length === 0).map((result) => result.storeSlug),
    },
  };
}
