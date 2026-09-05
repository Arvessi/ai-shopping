import assert from "node:assert/strict";
import test from "node:test";
import { syncCollectorStores } from "../collector/batch-sync.ts";
import type { CollectedOffer, CollectorStore } from "../collector/types.ts";

const stores: CollectorStore[] = [
  { slug: "feed-shop", name: "Feed Shop", origin: "https://feed.example", country: "LV", feedUrls: ["https://feed.example/feed.xml"], sitemapUrls: [] },
  { slug: "fallback-shop", name: "Fallback Shop", origin: "https://fallback.example", country: "LV", sitemapUrls: [] },
];

function offer(slug: string): CollectedOffer {
  return {
    merchantSlug: slug,
    merchantName: slug,
    merchantCountry: "LV",
    url: `https://${slug}.example/product`,
    title: "Example Product",
    price: 100,
    currency: "EUR",
    fetchedAt: new Date().toISOString(),
  };
}

test("batch summary reports source coverage and discovery fallback usage", async () => {
  const result = await syncCollectorStores(stores, {
    "merchant-feed": async (store) => ({
      source: "merchant-feed",
      offers: store.slug === "feed-shop" ? [offer(store.slug)] : [],
    }),
    "catalog-adapter": async () => ({ source: "catalog-adapter", offers: [] }),
    "discovery-fallback": async (store) => ({
      source: "discovery-fallback",
      offers: store.slug === "fallback-shop" ? [offer(store.slug)] : [],
    }),
  });

  assert.equal(result.summary.stores, 2);
  assert.equal(result.summary.storesWithOffers, 2);
  assert.equal(result.summary.totalOffers, 2);
  assert.equal(result.summary.selectedBySource["merchant-feed"], 1);
  assert.equal(result.summary.selectedBySource["discovery-fallback"], 1);
  assert.equal(result.summary.fellThroughToDiscovery, 1);
  assert.deepEqual(result.summary.failedStores, []);
});
