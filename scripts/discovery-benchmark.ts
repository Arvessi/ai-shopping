import { discoverProductUrls, knownMerchantDomains } from "../collector/discovery.ts";

const benchmarkQueries = [
  "Sony WH-1000XM5",
  "MacBook Air M3",
  "LG OLED C4 55",
  "Canon EOS R50",
  "Epson EcoTank L3250",
  "Lenovo Legion 5",
];

console.log(`CENIQ discovery benchmark: ${knownMerchantDomains().length} merchant domains`);

for (const query of benchmarkQueries) {
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
