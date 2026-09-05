import type { CollectorSourceKind, CollectorStore } from "./types.ts";

export type CollectorSourcePlan = {
  storeSlug: string;
  orderedSources: CollectorSourceKind[];
};

/**
 * CENIQ source priority is intentionally feed-first.
 *
 * 1. Merchant/public XML or CSV feed when available.
 * 2. Sitemap catalogue discovery. Empty configured sitemapUrls means the
 *    handler should discover Sitemap directives from public robots.txt.
 * 3. Store-specific catalogue/category adapter.
 * 4. External discovery only for seeding gaps, never as user-search runtime.
 */
export function sourcePlanForStore(store: CollectorStore): CollectorSourcePlan {
  const orderedSources: CollectorSourceKind[] = ["merchant-feed", "sitemap"];

  orderedSources.push("catalog-adapter", "discovery-fallback");

  return { storeSlug: store.slug, orderedSources };
}
