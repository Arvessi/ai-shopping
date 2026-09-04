import type { CollectorStore } from "./types.ts";

// v2 starts with stores where catalogue discovery can happen without user-search API calls.
// Add stores only when we have a public catalogue/sitemap/feed path and can respect robots rules.
export const collectorStores: CollectorStore[] = [
  {
    slug: "220",
    name: "220.lv",
    origin: "https://220.lv",
    country: "LV",
    sitemapUrls: ["https://220.lv/lv/sitemap-index.xml"],
    productUrlHints: ["/lv/"],
    crawlDelayMs: 1100,
  },
  {
    slug: "rd",
    name: "RD Electronics",
    origin: "https://www.rdveikals.lv",
    country: "LV",
    sitemapUrls: [],
    productUrlHints: ["/products/"],
    crawlDelayMs: 1200,
  },
];

export function getCollectorStore(slug: string) {
  return collectorStores.find((store) => store.slug === slug);
}
