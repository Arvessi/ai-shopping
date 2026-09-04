import assert from "node:assert/strict";
import test from "node:test";
import { collectedOfferToCandidate } from "../collector/canonical-bridge.ts";

test("collector offer maps into canonical candidate with stable merchant identity", () => {
  const candidate = collectedOfferToCandidate({
    merchantSlug: "bite",
    merchantName: "Bite",
    merchantCountry: "LV",
    url: "https://www.bite.lv/lv/telefoni/example-phone",
    title: "Example Phone 256GB Black",
    price: 699.99,
    currency: "EUR",
    imageUrl: "https://cdn.example/phone.jpg",
    availability: "https://schema.org/InStock",
    brand: "Example",
    sku: "EX-256-BLK",
    gtin: "1234567890123",
    fetchedAt: new Date().toISOString(),
  });

  assert.equal(candidate.merchant.slug, "bite");
  assert.equal(candidate.merchant.domain, "bite.lv");
  assert.equal(candidate.price, 699.99);
  assert.equal(candidate.evidence?.explicitOneTime, true);
  assert.ok(candidate.sourceKey.length >= 32);
  assert.ok(candidate.identifiers?.some((item) => item.type === "GTIN" && item.value === "1234567890123"));
  assert.ok(candidate.identifiers?.some((item) => item.type === "SKU_ALIAS" && item.value === "EX-256-BLK"));
});
