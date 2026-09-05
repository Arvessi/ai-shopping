import { collectorStores } from "../collector/store-registry.ts";

const USER_AGENT = "CENIQ-Catalog-Collector/2.0 (+https://ceniq.lv)";
const timeoutMs = 10_000;

async function probe(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/plain,text/html,application/xml;q=0.9,*/*;q=0.8" },
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text().catch(() => "");
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    return { ok: false, status: 0, text: "", error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function sitemapsFromRobots(text: string, origin: string) {
  const urls = [...text.matchAll(/^\s*Sitemap:\s*(https?:\/\/\S+)\s*$/gim)]
    .map((match) => match[1].trim())
    .filter((url) => {
      try {
        return new URL(url).origin === new URL(origin).origin;
      } catch {
        return false;
      }
    });
  return Array.from(new Set(urls));
}

const results = [];

for (const store of collectorStores) {
  const root = await probe(store.origin);
  const robotsUrl = new URL("/robots.txt", store.origin).toString();
  const robots = await probe(robotsUrl);
  const declaredSitemaps = robots.ok ? sitemapsFromRobots(robots.text, store.origin) : [];
  const configuredSitemaps = store.sitemapUrls;
  const sitemapCandidates = Array.from(new Set([...configuredSitemaps, ...declaredSitemaps]));

  let sitemapStatus: number | null = null;
  let sitemapOk = false;
  if (sitemapCandidates[0]) {
    const sitemap = await probe(sitemapCandidates[0]);
    sitemapStatus = sitemap.status;
    sitemapOk = sitemap.ok;
  }

  const classification = sitemapOk
    ? "sitemap-ready"
    : root.ok && robots.ok
      ? sitemapCandidates.length
        ? "sitemap-blocked"
        : "needs-catalog-adapter"
      : root.ok
        ? "robots-blocked-or-missing"
        : "datacenter-blocked-or-unreachable";

  results.push({
    slug: store.slug,
    name: store.name,
    origin: store.origin,
    rootStatus: root.status,
    robotsStatus: robots.status,
    sitemapCandidates,
    sitemapStatus,
    classification,
  });
}

console.log(JSON.stringify({ checkedAt: new Date().toISOString(), stores: results }, null, 2));

const ready = results.filter((row) => row.classification === "sitemap-ready");
const adapter = results.filter((row) => row.classification === "needs-catalog-adapter");
console.log(`\nSUMMARY sitemap-ready=${ready.length} needs-adapter=${adapter.length} total=${results.length}`);

// The probe is diagnostic: blocked merchants are expected and must not fail CI.
process.exitCode = 0;
