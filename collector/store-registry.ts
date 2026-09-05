import { LATVIA_ELECTRONICS_STORES } from "../lib/store-registry.ts";
import type { CollectorStore } from "./types.ts";

type StoreOverride = Partial<
  Pick<CollectorStore, "feedUrls" | "sitemapUrls" | "catalogUrls" | "productUrlHints" | "crawlDelayMs">
>;

// Keep store-specific knowledge small. Every LV-native merchant from the canonical
// registry automatically participates in catalogue discovery; overrides only add
// stronger public sources or URL hints when we know them.
const overrides: Record<string, StoreOverride> = {
  "220": {
    sitemapUrls: ["https://220.lv/lv/sitemap-index.xml"],
    productUrlHints: ["/lv/"],
  },
  rd: {
    productUrlHints: ["/products/"],
    catalogUrls: ["https://www.rdveikals.lv/categories/lv/188/sort/5/filter/0_0_0_0/page/1/Mobilie-telefoni.html"],
  },
  euronics: {
    catalogUrls: [
      "https://www.euronics.lv/telefoni/viedtalruni",
      "https://www.euronics.lv/it/portativie-datori/klepjdatori",
      "https://www.euronics.lv/tv/televizori",
    ],
  },
  tet: {
    catalogUrls: [
      "https://www.tet.lv/veikals/telefoni/apple.html",
      "https://www.tet.lv/veikals",
    ],
    productUrlHints: ["/veikals/"],
  },
  evelatus: {
    catalogUrls: [
      "https://evelatus.lv/veikals/",
      "https://evelatus.lv/produkta-kategorija/telefoni/",
    ],
    productUrlHints: ["/produkts/", "/product/"],
  },
  lmt: {
    catalogUrls: ["https://www.lmt.lv/veikals/visi-telefoni"],
  },
  tele2: {
    catalogUrls: ["https://www.tele2.lv/telefoni/"],
  },
};

// "core" is the proven/default sweep used by bootstrap and coverage. Tet and
// Evelatus are included because both expose public product/catalog pages and can
// materially improve phone/electronics merchant overlap.
export const coreCollectorStoreSlugs = ["euronics", "m79", "bite", "lmt", "tele2", "tet", "evelatus", "rd"] as const;

export const collectorStores: CollectorStore[] = LATVIA_ELECTRONICS_STORES.map((seed) => {
  const override = overrides[seed.slug] || {};
  return {
    slug: seed.slug,
    name: seed.name,
    origin: seed.origin,
    country: "LV",
    feedUrls: override.feedUrls,
    sitemapUrls: override.sitemapUrls ?? [],
    catalogUrls: override.catalogUrls,
    productUrlHints: override.productUrlHints,
    crawlDelayMs: override.crawlDelayMs ?? seed.crawlDelayMs ?? 1000,
  };
});

export function getCollectorStore(slug: string) {
  return collectorStores.find((store) => store.slug === slug);
}
