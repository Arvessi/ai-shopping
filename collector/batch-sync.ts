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
  urlsDiscovered: number;
  productPagesExamined: number;
  productsParsed: number;
  rejected: number;
  rejectionReasons: Record<string, number>;
  durationMs: number;
  tavilyCalls: number;
};

export type BatchSyncResult = {
  results: StoreSyncResult[];
  summary: BatchSyncSummary;
};

export async function syncCollectorStores(
  stores: CollectorStore[],
  handlers: CollectorSourceHandlers,
): Promise<BatchSyncResult> {
  const startedAt = Date.now();
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
  const rejectionReasons: Record<string, number> = {};
  for (const result of results) for (const attempt of result.attempts) {
    for (const [reason, count] of Object.entries(attempt.rejectionReasons || {})) {
      rejectionReasons[reason] = (rejectionReasons[reason] || 0) + count;
    }
  }

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
      urlsDiscovered: results.reduce((sum, result) => sum + result.attempts.reduce((inner, attempt) => inner + (attempt.discovered || 0), 0), 0),
      productPagesExamined: results.reduce((sum, result) => sum + result.attempts.reduce((inner, attempt) => inner + (attempt.examined || 0), 0), 0),
      productsParsed: results.reduce((sum, result) => sum + result.offers.length, 0),
      rejected: results.reduce((sum, result) => sum + result.attempts.reduce((inner, attempt) => inner + (attempt.rejected || 0), 0), 0),
      rejectionReasons,
      durationMs: Date.now() - startedAt,
      tavilyCalls: 0,
    },
  };
}
