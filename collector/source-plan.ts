import type { CollectorSourceKind, CollectorStore } from "./types.ts";

export type CollectorSourcePlan = {
  storeSlug: string;
  orderedSources: CollectorSourceKind[];
};

/**
 * CENIQ source priority is intentionally feed-first.
 *
 * 1. Merchant/public XML or CSV feed when available.
 * 2. Sitemap catalogue discovery.
 * 3. Store-specific catalogue/category adapter.
 * 4. External discovery only for seeding gaps, never as user-search runtime.
 */
export function sourcePlanForStore(store: CollectorStore): CollectorSourcePlan {
  const orderedSources: CollectorSourceKind[] = [];

  if ((store.feedUrls?.length ?? 0) > 0) orderedSources.push("merchant-feed");
  if (store.sitemapUrls.length > 0) orderedSources.push("sitemap");

  orderedSources.push("catalog-adapter", "discovery-fallback");

  // Even before a feed URL is configured, keep feed as the preferred future
  // source so onboarding a merchant never requires changing orchestration code.
  if (!orderedSources.includes("merchant-feed")) {
    orderedSources.unshift("merchant-feed");
  }

  return { storeSlug: store.slug, orderedSources };
}
