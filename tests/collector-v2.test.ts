import assert from "node:assert/strict";
import test from "node:test";
import { parseProductPage, isAllowedCatalogItem } from "../collector/product-page.ts";
import { parseSitemapXml, looksLikeProductUrl } from "../collector/sitemap.ts";
import { knownMerchantDomains } from "../collector/discovery.ts";
import { discoveryMerchants } from "../collector/discovery-merchants.ts";
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

test("recognizes Euronics deep SKU product URLs", () => {
  assert.equal(
    looksLikeProductUrl(
      "https://www.euronics.lv/telefoni/viedtalruni/android/sm-a165fzkbeue/samsung-galaxy-a16-lte-128-gb-melna-viedtalrunis",
      [],
      "euronics",
    ),
    true,
  );
  assert.equal(looksLikeProductUrl("https://www.euronics.lv/telefoni", [], "euronics"), false);
});

test("recognizes LMT store product URLs but not category landing pages", () => {
  assert.equal(looksLikeProductUrl("https://www.lmt.lv/veikals/visi-telefoni/samsung-galaxy-s25", [], "lmt"), true);
  assert.equal(looksLikeProductUrl("https://www.lmt.lv/veikals/visi-telefoni", [], "lmt"), false);
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

test("extracts LMT one-time purchase price and model without JSON-LD offer", () => {
  const lmtStore: CollectorStore = {
    slug: "lmt",
    name: "LMT",
    origin: "https://www.lmt.lv",
    country: "LV",
    sitemapUrls: [],
  };
  const html = `
    <html>
      <head><meta property="og:title" content="Samsung Galaxy S25 - LMT"></head>
      <body>
        <h1>Samsung Galaxy S25</h1>
        <div>Modelis SM-S931BDBDEUE</div>
        <div>Ar Nomaksas līgumu 26.21 €/mēn.</div>
        <div>Pērkot uzreiz Maksā ar karti 628.99 €</div>
      </body>
    </html>`;

  const offer = parseProductPage(html, "https://www.lmt.lv/veikals/visi-telefoni/samsung-galaxy-s25", lmtStore);
  assert.ok(offer);
  assert.equal(offer.price, 628.99);
  assert.equal(offer.sku, "SM-S931BDBDEUE");
});

test("M79 selects consumer price and never the lower Bez PVN price", () => {
  const m79Store: CollectorStore = {
    slug: "m79",
    name: "M79",
    origin: "https://m79.lv",
    country: "LV",
    sitemapUrls: [],
  };
  const html = `
    <html><body>
      <h1>Xiaomi Redmi Note 13 Dual 4G 6/128GB Ice Blue Damaged Box (00101950) Mobilais Telefons</h1>
      <div>Galvenie parametri: Vairāk par preci 150.00 € Bez PVN 123.97 € Daudzums Ielikt grozā</div>
    </body></html>`;

  const offer = parseProductPage(
    html,
    "https://m79.lv/mobile-phone/mobilie-telefoni/xiaomi-redmi-note-13-dual-4g-6128gb-ice-blue-damaged-box-00101950",
    m79Store,
  );
  assert.ok(offer);
  assert.equal(offer.price, 150);
  assert.equal(offer.sku, "00101950");
});

test("catalog safety layer rejects restricted retail items", () => {
  assert.equal(isAllowedCatalogItem("Example smartphone 256GB"), true);
  assert.equal(isAllowedCatalogItem("nicotine vape device"), false);
  assert.equal(isAllowedCatalogItem("online casino betting"), false);
  assert.equal(isAllowedCatalogItem("restricted weapon listing"), false);
});

test("discovery universe covers broad LV catalogue and Baltic candidates", () => {
  const lv = discoveryMerchants.filter((merchant) => merchant.market === "LV");
  const baltic = discoveryMerchants.filter((merchant) => merchant.market === "LT" || merchant.market === "EE");
  assert.ok(lv.length >= 40, `expected at least 40 LV merchants, got ${lv.length}`);
  assert.ok(baltic.length >= 5, `expected at least 5 Baltic candidates, got ${baltic.length}`);
  assert.ok(knownMerchantDomains().length >= 45);
  assert.ok(discoveryMerchants.some((merchant) => merchant.slug === "ksenukai"));
  assert.ok(discoveryMerchants.some((merchant) => merchant.slug === "sportland"));
  assert.ok(discoveryMerchants.some((merchant) => merchant.slug === "trodo"));
  assert.ok(discoveryMerchants.some((merchant) => merchant.slug === "varle-lt" && merchant.deliveryToLatvia === "verify"));
});
