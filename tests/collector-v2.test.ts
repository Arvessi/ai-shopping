import assert from "node:assert/strict";
import test from "node:test";
import { parseProductPage, isAllowedCatalogItem } from "../collector/product-page.ts";
import { parseSitemapXml, looksLikeProductUrl } from "../collector/sitemap.ts";
import type { CollectorStore } from "../collector/types.ts";

const store: CollectorStore = {
  slug: "test",
  name: "Test Shop",
  origin: "https://shop.example",
  country: "LV",
  sitemapUrls: [],
};

test("parses sitemap index and urlset", () => {
  const index = parseSitemapXml(`<?xml version="1.0"?><sitemapindex><sitemap><loc>https://shop.example/a.xml</loc></sitemap></sitemapindex>`);
  assert.equal(index.kind, "index");
  assert.equal(index.entries[0]?.loc, "https://shop.example/a.xml");

  const urls = parseSitemapXml(`<?xml version="1.0"?><urlset><url><loc>https://shop.example/p/abc</loc><lastmod>2026-09-04</lastmod></url></urlset>`);
  assert.equal(urls.kind, "urlset");
  assert.deepEqual(urls.entries[0], { loc: "https://shop.example/p/abc", lastmod: "2026-09-04" });
});

test("filters obvious non-product URLs", () => {
  assert.equal(looksLikeProductUrl("https://shop.example/products/phone", ["/products/"]), true);
  assert.equal(looksLikeProductUrl("https://shop.example/search/phone", ["/products/"]), false);
});

test("extracts a generic schema.org Product offer", () => {
  const html = `
    <html><head>
    <script type="application/ld+json">
    {
      "@context":"https://schema.org",
      "@type":"Product",
      "name":"Example Phone 256GB Black",
      "image":"https://cdn.example/phone.jpg",
      "brand":{"@type":"Brand","name":"Example"},
      "sku":"ABC-256-BLK",
      "gtin13":"1234567890123",
      "offers":{"@type":"Offer","price":"699.99","priceCurrency":"EUR","availability":"https://schema.org/InStock"}
    }
    </script></head></html>`;

  const offer = parseProductPage(html, "https://shop.example/products/phone", store);
  assert.ok(offer);
  assert.equal(offer.title, "Example Phone 256GB Black");
  assert.equal(offer.price, 699.99);
  assert.equal(offer.currency, "EUR");
  assert.equal(offer.brand, "Example");
  assert.equal(offer.gtin, "1234567890123");
  assert.equal(offer.imageUrl, "https://cdn.example/phone.jpg");
});

test("catalog safety layer rejects age-restricted or dangerous retail items", () => {
  assert.equal(isAllowedCatalogItem("Example smartphone 256GB"), true);
  assert.equal(isAllowedCatalogItem("nicotine vape device"), false);
  assert.equal(isAllowedCatalogItem("firearm ammunition"), false);
  assert.equal(isAllowedCatalogItem("online casino betting"), false);
});
