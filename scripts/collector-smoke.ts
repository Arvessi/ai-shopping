import { collectorStores, getCollectorStore } from "../collector/store-registry.ts";
import { expandSitemaps, fetchText, resolveStoreSitemapUrls, sleep } from "../collector/http.ts";
import { looksLikeProductUrl } from "../collector/sitemap.ts";
import { parseProductPage } from "../collector/product-page.ts";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const storeSlug = arg("store") ?? "220";
const limit = Math.max(1, Math.min(50, Number(arg("limit") ?? 10)));
const store = getCollectorStore(storeSlug);

if (!store) {
  console.error(`Unknown store: ${storeSlug}. Available: ${collectorStores.map((item) => item.slug).join(", ")}`);
  process.exit(1);
}

const sitemapRoots = await resolveStoreSitemapUrls(store);
if (!sitemapRoots.length) {
  console.error(`No public sitemap discovered for ${store.name}. This store needs a catalogue/category adapter.`);
  process.exit(2);
}

console.log(JSON.stringify({ stage: "sitemaps", store: store.slug, roots: sitemapRoots }, null, 2));

const sitemapEntries = await expandSitemaps(store, sitemapRoots, 8);
const candidates = sitemapEntries
  .map((entry) => entry.loc)
  .filter((url) => looksLikeProductUrl(url, store.productUrlHints))
  .slice(0, Math.max(limit * 8, 50));

const offers = [];
const errors: { url: string; error: string }[] = [];

for (const url of candidates) {
  if (offers.length >= limit) break;
  try {
    const html = await fetchText(url);
    const offer = parseProductPage(html, url, store);
    if (offer) offers.push(offer);
  } catch (error) {
    errors.push({ url, error: error instanceof Error ? error.message : String(error) });
  }
  await sleep(store.crawlDelayMs ?? 1000);
}

console.log(JSON.stringify({
  store: store.slug,
  discoveredUrls: sitemapEntries.length,
  candidateUrls: candidates.length,
  parsedOffers: offers.length,
  offers,
  errors: errors.slice(0, 10),
}, null, 2));

if (!offers.length) process.exitCode = 3;
