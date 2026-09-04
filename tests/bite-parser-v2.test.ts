import assert from "node:assert/strict";
import test from "node:test";
import { parseProductPage } from "../collector/product-page.ts";
import { looksLikeProductUrl } from "../collector/sitemap.ts";
import type { CollectorStore } from "../collector/types.ts";

const biteStore: CollectorStore = {
  slug: "bite",
  name: "Bite",
  origin: "https://www.bite.lv",
  country: "LV",
  sitemapUrls: [],
};

test("Bite product URL filter accepts device pages and rejects content pages", () => {
  assert.equal(
    looksLikeProductUrl("https://www.bite.lv/lv/telefoni/apple-iphone-16", [], "bite"),
    true,
  );
  assert.equal(
    looksLikeProductUrl("https://www.bite.lv/lv/telefoni", [], "bite"),
    false,
  );
  assert.equal(
    looksLikeProductUrl("https://www.bite.lv/lv/zinas/jaunumi", [], "bite"),
    false,
  );
});

test("Bite parser extracts one-time price and SKU without JSON-LD offer", () => {
  const html = `
    <html>
      <head>
        <meta property="og:title" content="Apple iPhone 16 | Telefoni | Bite">
        <meta property="og:image" content="https://cdn.example/iphone16.jpg">
      </head>
      <body>
        <h1>Apple iPhone 16 128 GB, Melns</h1>
        <div>0% nomaksā 36,62 € / mēn.</div>
        <div>Pērkot uzreiz 879,00 €</div>
        <div>SKU kods:19535BLACK</div>
      </body>
    </html>`;

  const offer = parseProductPage(
    html,
    "https://www.bite.lv/lv/telefoni/apple-iphone-16",
    biteStore,
  );

  assert.ok(offer);
  assert.equal(offer.title, "Apple iPhone 16 128 GB, Melns");
  assert.equal(offer.price, 879);
  assert.equal(offer.currency, "EUR");
  assert.equal(offer.sku, "19535BLACK");
  assert.equal(offer.imageUrl, "https://cdn.example/iphone16.jpg");
});
