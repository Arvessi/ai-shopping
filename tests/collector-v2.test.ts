import assert from "node:assert/strict";
import test from "node:test";
import { parseProductPage, isAllowedCatalogItem } from "../collector/product-page.ts";
import { parseSitemapXml, looksLikeProductUrl } from "../collector/sitemap.ts";
import { knownMerchantDomains } from "../collector/discovery.ts";
import { discoveryMerchants } from "../collector/discovery-merchants.ts";
import { parseMerchantXmlFeed } from "../collector/feed.ts";
import { syncCollectorStore } from "../collector/orchestrator.ts";
import { catalogProductLinks } from "../collector/catalog-adapter.ts";
import type { CollectedOffer, CollectorStore } from "../collector/types.ts";

const store: CollectorStore = {
  slug: "test",
  name: "Test Shop",
  origin: "https://shop.example",
  country: "LV",
  sitemapUrls: [],
};

function fakeOffer(source = "feed"): CollectedOffer {
  return {
    merchantSlug: "test",
    merchantName: "Test Shop",
    merchantCountry: "LV",
    url: `https://shop.example/${source}/product`,
    title: "Example Product",
    price: 99.99,
    currency: "EUR",
    fetchedAt: new Date().toISOString(),
  };
}

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

test("extracts labelled one-time price and SKU from a product page without JSON-LD", () => {
  const euronicsStore: CollectorStore = {
    slug: "euronics", name: "Euronics", origin: "https://www.euronics.lv", country: "LV", sitemapUrls: [],
  };
  const html = `<html><head><meta property="og:type" content="product"><meta property="og:title" content="Sony WH-1000XM5, melna - Euronics"><meta property="og:image" content="https://img.example/xm5.jpg"></head><body><h1>Sony WH-1000XM5</h1><div>Preces kods: WH1000XM5B</div><div>Cena: 329.99 €</div></body></html>`;
  const offer = parseProductPage(html, "https://www.euronics.lv/audio/austinas/WH1000XM5B/sony-wh-1000xm5", euronicsStore);
  assert.ok(offer);
  assert.equal(offer.price, 329.99);
  assert.equal(offer.sku, "WH1000XM5B");
});

test("listing adapter respects base href and filters LMT comparison links", () => {
  const rdStore: CollectorStore = { slug: "rd", name: "RD", origin: "https://www.rdveikals.lv", country: "LV", sitemapUrls: [], productUrlHints: ["/products/"] };
  assert.deepEqual(catalogProductLinks(`<base href="/"><a href="products/lv/1/42/phone.html">Phone</a>`, "https://www.rdveikals.lv/categories/lv/page/1", rdStore), ["https://www.rdveikals.lv/products/lv/1/42/phone.html"]);
  const lmtStore: CollectorStore = { slug: "lmt", name: "LMT", origin: "https://www.lmt.lv", country: "LV", sitemapUrls: [] };
  assert.deepEqual(catalogProductLinks(`<a href="/veikals/visi-telefoni/iphone-16/128-gb?payment-type=installment-24">Phone</a><a href="/veikals/visi-telefoni/salidzini">Compare</a>`, lmtStore.origin, lmtStore), ["https://www.lmt.lv/veikals/visi-telefoni/iphone-16/128-gb"]);
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

test("Tele2 uses the explicit one-time price and ignores the monthly payment", () => {
  const tele2Store: CollectorStore = { slug: "tele2", name: "Tele2", origin: "https://www.tele2.lv", country: "LV", sitemapUrls: [] };
  const html = `<html><head><meta name="description" content="Samsung Galaxy A16 uz nomaksu 3,95 €/mēn., pērkot uzreiz 95,00 €. Tele2"></head><body><h1>Samsung Galaxy A16 LTE 128GB</h1></body></html>`;
  const offer = parseProductPage(html, "https://www.tele2.lv/telefoni/galaxy-a16-lte-128gb/", tele2Store);
  assert.ok(offer);
  assert.equal(offer.price, 95);
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

test("imports a conventional product XML feed without merchant-specific mapping", () => {
  const xml = `
    <catalog><products>
      <product>
        <name>Example Laptop 16GB 512GB</name>
        <link>https://shop.example/laptop-16-512</link>
        <price>799,99 EUR</price>
        <brand>Example</brand>
        <ean>1234567890123</ean>
        <image_url>https://cdn.example/laptop.jpg</image_url>
        <stock>in_stock</stock>
      </product>
    </products></catalog>`;

  const result = parseMerchantXmlFeed(xml, store);
  assert.equal(result.totalItems, 1);
  assert.equal(result.rejected, 0);
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0]?.price, 799.99);
  assert.equal(result.offers[0]?.gtin, "1234567890123");
  assert.equal(result.offers[0]?.imageUrl, "https://cdn.example/laptop.jpg");
});

test("imports offer-style XML aliases and rejects unsafe catalogue entries", () => {
  const xml = `
    <shop><offers>
      <offer>
        <title>Example TV 55 OLED</title>
        <url>https://shop.example/tv/oled-55</url>
        <sale_price>1099.00</sale_price>
        <currency>EUR</currency>
        <manufacturer>Example</manufacturer>
        <product_id>TV-55-1</product_id>
      </offer>
      <offer>
        <title>nicotine vape device</title>
        <url>https://shop.example/restricted-item</url>
        <price>19.99</price>
      </offer>
    </offers></shop>`;

  const result = parseMerchantXmlFeed(xml, store);
  assert.equal(result.totalItems, 2);
  assert.equal(result.offers.length, 1);
  assert.equal(result.rejected, 1);
  assert.equal(result.offers[0]?.sku, "TV-55-1");
});

test("orchestrator stops after feed success and never spends discovery fallback", async () => {
  let discoveryCalls = 0;
  const feedStore: CollectorStore = { ...store, feedUrls: ["https://shop.example/feed.xml"] };
  const result = await syncCollectorStore(feedStore, {
    "merchant-feed": async () => ({ source: "merchant-feed", offers: [fakeOffer("feed")] }),
    "discovery-fallback": async () => {
      discoveryCalls += 1;
      return { source: "discovery-fallback", offers: [fakeOffer("discovery")] };
    },
  });

  assert.equal(result.selectedSource, "merchant-feed");
  assert.equal(result.offers.length, 1);
  assert.equal(discoveryCalls, 0);
  assert.equal(result.attempts[0]?.status, "success");
});

test("orchestrator falls through empty sources until a later source succeeds", async () => {
  const attempted: string[] = [];
  const sitemapStore: CollectorStore = { ...store, sitemapUrls: ["https://shop.example/sitemap.xml"] };
  const result = await syncCollectorStore(sitemapStore, {
    "merchant-feed": async () => {
      attempted.push("feed");
      return { source: "merchant-feed", offers: [] };
    },
    "catalog-adapter": async () => {
      attempted.push("adapter");
      return { source: "catalog-adapter", offers: [fakeOffer("adapter")] };
    },
    "discovery-fallback": async () => {
      attempted.push("discovery");
      return { source: "discovery-fallback", offers: [fakeOffer("discovery")] };
    },
  });

  assert.deepEqual(attempted, ["feed", "adapter"]);
  assert.equal(result.selectedSource, "catalog-adapter");
  assert.equal(result.attempts[0]?.status, "empty");
  assert.equal(result.attempts[1]?.source, "sitemap");
  assert.equal(result.attempts[1]?.status, "unavailable");
  assert.equal(result.attempts[2]?.status, "success");
});
