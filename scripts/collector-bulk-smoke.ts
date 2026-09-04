import { createDefaultCollectorHandlers } from "../collector/default-handlers.ts";
import { syncCollectorStores } from "../collector/batch-sync.ts";
import { collectedOfferToCandidate } from "../collector/canonical-bridge.ts";
import { collectorStores } from "../collector/store-registry.ts";
import { resolveCandidate } from "../lib/canonical/domain.ts";

const requested = (process.argv[2] || "euronics,m79,bite,lmt,tele2,rd").split(",").map((value) => value.trim()).filter(Boolean);
const limit = Math.min(100, Math.max(1, Number(process.argv[3] || 20)));
const cursor = Math.max(0, Math.floor(Number(process.argv[4] || 0)));
const stores = requested.map((slug) => collectorStores.find((store) => store.slug === slug)).filter((store): store is NonNullable<typeof store> => Boolean(store));
const benchmarks = ["Samsung Galaxy S25", "iPhone 16", "Sony WH-1000XM5", "Lenovo Legion 5", "LG OLED C4", "Canon EOS R50", "Epson EcoTank L3250"];
const batch = await syncCollectorStores(stores, createDefaultCollectorHandlers({ maxSitemaps: 12, maxProductPages: limit, pageDelayMs: 100, sampleOffset: cursor, priorityQueries: benchmarks }));
const resolved = batch.results.flatMap((result) => result.offers.map((offer) => ({ offer, resolved: resolveCandidate(collectedOfferToCandidate(offer)) })));
const canonicalReasons: Record<string, number> = {};
for (const row of resolved) if (row.resolved.validationStatus !== "ACCEPTED") canonicalReasons[row.resolved.rejectionReason || row.resolved.validationStatus.toLowerCase()] = (canonicalReasons[row.resolved.rejectionReason || row.resolved.validationStatus.toLowerCase()] || 0) + 1;

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  cursor,
  limit,
  summary: {
    ...batch.summary,
    canonicalAccepted: resolved.filter((row) => row.resolved.validationStatus === "ACCEPTED").length,
    canonicalQuarantinedOrRejected: resolved.filter((row) => row.resolved.validationStatus !== "ACCEPTED").length,
    canonicalReasons,
    distinctMerchants: new Set(resolved.filter((row) => row.resolved.validationStatus === "ACCEPTED").map((row) => row.offer.merchantSlug)).size,
  },
  stores: batch.results.map((result) => ({
    slug: result.storeSlug,
    selectedSource: result.selectedSource,
    offers: result.offers.length,
    attempts: result.attempts,
    samples: result.offers.slice(0, 3).map((offer) => ({ title: offer.title, price: offer.price, url: offer.url })),
  })),
  benchmarks: Object.fromEntries(benchmarks.map((query) => [query, resolved.filter((row) => row.offer.title.toLowerCase().includes(query.toLowerCase())).map((row) => ({ merchant: row.offer.merchantName, title: row.offer.title, price: row.offer.price }))])),
  tavilyCalls: 0,
}, null, 2));
