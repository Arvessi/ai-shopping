import type { CollectorStore } from "./types.ts";

// v2 starts with stores where catalogue discovery can happen without user-search API calls.
// Empty sitemapUrls means: discover Sitemap directives from public robots.txt first.
// Stores that block datacenter crawlers are classified by the probe and are not bypassed.
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
    slug: "1a",
    name: "1a.lv",
    origin: "https://www.1a.lv",
    country: "LV",
    sitemapUrls: [],
    crawlDelayMs: 1200,
  },
  {
    slug: "rd",
    name: "RD Electronics",
    origin: "https://www.rdveikals.lv",
    country: "LV",
    sitemapUrls: [],
    productUrlHints: ["/products/"],
    catalogUrls: ["https://www.rdveikals.lv/categories/lv/188/sort/5/filter/0_0_0_0/page/1/Mobilie-telefoni.html"],
    crawlDelayMs: 1200,
  },
  {
    slug: "euronics",
    name: "Euronics",
    origin: "https://www.euronics.lv",
    country: "LV",
    sitemapUrls: [],
    catalogUrls: ["https://www.euronics.lv/telefoni/viedtalruni", "https://www.euronics.lv/it/portativie-datori/klepjdatori", "https://www.euronics.lv/tv/televizori"],
    crawlDelayMs: 1200,
  },
  {
    slug: "dateks",
    name: "Dateks",
    origin: "https://www.dateks.lv",
    country: "LV",
    sitemapUrls: [],
    crawlDelayMs: 1200,
  },
  {
    slug: "aio",
    name: "AiO",
    origin: "https://aio.lv",
    country: "LV",
    sitemapUrls: [],
    crawlDelayMs: 1200,
  },
  {
    slug: "m79",
    name: "M79",
    origin: "https://m79.lv",
    country: "LV",
    sitemapUrls: [],
    crawlDelayMs: 1200,
  },
  {
    slug: "balticdata",
    name: "Baltic Data",
    origin: "https://www.balticdata.lv",
    country: "LV",
    sitemapUrls: [],
    crawlDelayMs: 1200,
  },
  {
    slug: "cenuklubs",
    name: "Cenu Klubs",
    origin: "https://www.cenuklubs.lv",
    country: "LV",
    sitemapUrls: [],
    crawlDelayMs: 1200,
  },
  {
    slug: "tet",
    name: "Tet",
    origin: "https://www.tet.lv",
    country: "LV",
    sitemapUrls: [],
    catalogUrls: ["https://www.tet.lv/veikals"],
    crawlDelayMs: 1200,
  },
  {
    slug: "bite",
    name: "Bite",
    origin: "https://www.bite.lv",
    country: "LV",
    sitemapUrls: [],
    crawlDelayMs: 1200,
  },
  {
    slug: "lmt",
    name: "LMT",
    origin: "https://www.lmt.lv",
    country: "LV",
    sitemapUrls: [],
    catalogUrls: ["https://www.lmt.lv/veikals/visi-telefoni"],
    crawlDelayMs: 1200,
  },
  {
    slug: "tele2",
    name: "Tele2",
    origin: "https://www.tele2.lv",
    country: "LV",
    sitemapUrls: [],
    catalogUrls: ["https://www.tele2.lv/telefoni/"],
    crawlDelayMs: 1200,
  },
];

export function getCollectorStore(slug: string) {
  return collectorStores.find((store) => store.slug === slug);
}
