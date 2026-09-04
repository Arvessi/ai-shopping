import { getCollectorStore } from "../collector/store-registry.ts";
import { expandSitemaps, fetchText, resolveStoreSitemapUrls, sleep } from "../collector/http.ts";
import { looksLikeProductUrl } from "../collector/sitemap.ts";
import { parseProductPage } from "../collector/product-page.ts";

const slugs = ["euronics", "m79", "bite", "lmt"];
const perStore = 2;
const maxCandidates = 20;
const report = [];

for (const slug of slugs) {
  const store = getCollectorStore(slug)!;
  try {
    const roots = await resolveStoreSitemapUrls(store);
    const entries = await expandSitemaps(store, roots, 12);
    const candidates = entries
      .map((entry) => entry.loc)
      .filter((url) => looksLikeProductUrl(url, store.productUrlHints, store.slug))
      .slice(0, maxCandidates);

    const offers = [];
    const errors: { url: string; error: string }[] = [];
    for (const url of candidates) {
      if (offers.length >= perStore) break;
      try {
        const html = await fetchText(url);
        const parsed = parseProductPage(html, url, store);
        if (parsed) offers.push(parsed);
      } catch (error) {
        errors.push({ url, error: error instanceof Error ? error.message : String(error) });
      }
      await sleep(Math.min(store.crawlDelayMs ?? 1000, 400));
    }

    report.push({
      slug,
      roots,
      discoveredUrls: entries.length,
      candidateUrls: candidates.length,
      candidateSamples: candidates.slice(0, 5),
      parsedOffers: offers.length,
      offers,
      errors: errors.slice(0, 5),
    });
  } catch (error) {
    report.push({ slug, error: error instanceof Error ? error.message : String(error) });
  }
}

console.log(JSON.stringify({ checkedAt: new Date().toISOString(), stores: report }, null, 2));

const successful = report.filter((row: any) => Number(row.parsedOffers || 0) > 0).length;
console.log(`\nSUMMARY stores-with-offers=${successful}/${slugs.length}`);
process.exitCode = successful > 0 ? 0 : 2;
