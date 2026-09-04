import { discoverProductUrls, knownMerchantDomains } from "../collector/discovery.ts";

const benchmarkQueries = [
  "Sony WH-1000XM5",
  "MacBook Air M3",
  "LG OLED C4 55",
  "Canon EOS R50",
  "Epson EcoTank L3250",
  "Lenovo Legion 5",
];

const DEFAULT_MAX_QUERIES = 6;
const requestedMax = Number.parseInt(process.env.MAX_DISCOVERY_QUERIES ?? String(DEFAULT_MAX_QUERIES), 10);
const maxQueries = Number.isFinite(requestedMax)
  ? Math.max(0, Math.min(requestedMax, DEFAULT_MAX_QUERIES))
  : DEFAULT_MAX_QUERIES;
const queriesToRun = benchmarkQueries.slice(0, maxQueries);

console.log(`CENIQ discovery benchmark: ${knownMerchantDomains().length} merchant domains`);
console.log(`Credit safety: max ${queriesToRun.length} provider calls this run (hard ceiling ${DEFAULT_MAX_QUERIES})`);

for (const query of queriesToRun) {
  try {
    const result = await discoverProductUrls(query, {
      knownMerchantsOnly: true,
      maxResults: 20,
      country: "latvia",
      language: "lv",
    });

    const merchants = [...new Set(result.candidates.map((candidate) => candidate.merchantSlug).filter(Boolean))];
    console.log(JSON.stringify({
      query,
      provider: result.source,
      candidates: result.candidates.length,
      merchantCount: merchants.length,
      merchants,
      sample: result.candidates.slice(0, 5).map((candidate) => ({
        merchant: candidate.merchantSlug,
        market: candidate.market,
        deliveryToLatvia: candidate.deliveryToLatvia,
        title: candidate.title,
        url: candidate.url,
      })),
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      query,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
  }
}
