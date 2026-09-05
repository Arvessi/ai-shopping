import { parseSitemapXml, sameOrigin } from "./sitemap.ts";
import type { CollectorStore, SitemapEntry } from "./types.ts";

const USER_AGENT = "CENIQ-Catalog-Collector/2.0 (+https://ceniq.lv)";

export async function fetchText(url: string, timeoutMs = 15_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverSitemapsFromRobots(origin: string): Promise<string[]> {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const robots = await fetchText(robotsUrl, 8_000);
  return [...robots.matchAll(/^\s*Sitemap:\s*(https?:\/\/\S+)\s*$/gim)]
    .map((match) => match[1].trim())
    .filter((url) => sameOrigin(url, origin));
}

export async function resolveStoreSitemapUrls(store: CollectorStore): Promise<string[]> {
  if (store.sitemapUrls.length) return store.sitemapUrls;
  try {
    return await discoverSitemapsFromRobots(store.origin);
  } catch {
    return [];
  }
}

export async function expandSitemaps(
  store: CollectorStore,
  roots: string[],
  maxSitemaps = 20,
): Promise<SitemapEntry[]> {
  const queue = [...roots];
  const visited = new Set<string>();
  const urls: SitemapEntry[] = [];

  while (queue.length && visited.size < maxSitemaps) {
    const sitemapUrl = queue.shift()!;
    if (visited.has(sitemapUrl) || !sameOrigin(sitemapUrl, store.origin)) continue;
    visited.add(sitemapUrl);

    const xml = await fetchText(sitemapUrl, 10_000);
    const parsed = parseSitemapXml(xml);
    if (parsed.kind === "index") {
      for (const entry of parsed.entries) {
        if (!visited.has(entry.loc) && sameOrigin(entry.loc, store.origin)) queue.push(entry.loc);
      }
    } else if (parsed.kind === "urlset") {
      urls.push(...parsed.entries.filter((entry) => sameOrigin(entry.loc, store.origin)));
    }
  }

  return urls;
}

export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
