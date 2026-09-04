import { sourcePlanForStore } from "./source-plan.ts";
import type { CollectedOffer, CollectorSourceKind, CollectorStore } from "./types.ts";

export type SourceSyncResult = {
  source: CollectorSourceKind;
  offers: CollectedOffer[];
  examined?: number;
  rejected?: number;
  note?: string;
};

export type StoreSyncAttempt = {
  source: CollectorSourceKind;
  status: "success" | "empty" | "unavailable" | "error";
  offers: number;
  examined?: number;
  rejected?: number;
  message?: string;
};

export type StoreSyncResult = {
  storeSlug: string;
  selectedSource?: CollectorSourceKind;
  offers: CollectedOffer[];
  attempts: StoreSyncAttempt[];
};

export type CollectorSourceHandlers = Partial<
  Record<CollectorSourceKind, (store: CollectorStore) => Promise<SourceSyncResult>>
>;

/**
 * Runs one merchant sync in CENIQ source-priority order.
 *
 * First non-empty source wins. This prevents expensive discovery fallback from
 * running when a feed/sitemap/adapter already gives usable offers, and keeps
 * user-search runtime completely separate from catalogue ingestion.
 */
export async function syncCollectorStore(
  store: CollectorStore,
  handlers: CollectorSourceHandlers,
): Promise<StoreSyncResult> {
  const plan = sourcePlanForStore(store);
  const attempts: StoreSyncAttempt[] = [];

  for (const source of plan.orderedSources) {
    const handler = handlers[source];
    if (!handler) {
      attempts.push({ source, status: "unavailable", offers: 0 });
      continue;
    }

    try {
      const result = await handler(store);
      const offers = result.offers ?? [];
      attempts.push({
        source,
        status: offers.length > 0 ? "success" : "empty",
        offers: offers.length,
        examined: result.examined,
        rejected: result.rejected,
        message: result.note,
      });

      if (offers.length > 0) {
        return {
          storeSlug: store.slug,
          selectedSource: source,
          offers,
          attempts,
        };
      }
    } catch (error) {
      attempts.push({
        source,
        status: "error",
        offers: 0,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    storeSlug: store.slug,
    offers: [],
    attempts,
  };
}
