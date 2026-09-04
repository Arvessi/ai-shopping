export type CollectorSourceKind = "merchant-feed" | "sitemap" | "catalog-adapter" | "discovery-fallback";

export type CollectorStore = {
  slug: string;
  name: string;
  origin: string;
  country: "LV" | "LT" | "EE" | "DE" | "PL" | "EU";
  feedUrls?: string[];
  sitemapUrls: string[];
  catalogUrls?: string[];
  productUrlHints?: string[];
  crawlDelayMs?: number;
};

export type SitemapEntry = {
  loc: string;
  lastmod?: string;
};

export type CollectedOffer = {
  merchantSlug: string;
  merchantName: string;
  merchantCountry: string;
  url: string;
  title: string;
  price: number;
  currency: string;
  imageUrl?: string;
  availability?: string;
  brand?: string;
  sku?: string;
  gtin?: string;
  mpn?: string;
  category?: string;
  fetchedAt: string;
};
