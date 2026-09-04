import { fetchText, resolveStoreSitemapUrls, expandSitemaps, sleep } from "./http.ts";
import { parseMerchantXmlFeed } from "./feed.ts";
import { parseProductPage } from "./product-page.ts";
import { looksLikeProductUrl } from "./sitemap.ts";
import { catalogProductLinks } from "./catalog-adapter.ts";
import type { CollectorSourceHandlers } from "./orchestrator.ts";
import type { CollectedOffer, CollectorStore } from "./types.ts";

export type DefaultHandlerOptions = {
  maxSitemaps?: number;
  maxProductPages?: number;
  pageDelayMs?: number;
  sampleOffset?: number;
  priorityQueries?: string[];
};

function increment(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] || 0) + 1;
}

function diverseSample(urls: string[], limit: number, storeSlug: string, offset = 0) {
  const preferred = urls.filter((url) => {
    try {
      const first = new URL(url).pathname.split("/").filter(Boolean)[0]?.toLowerCase();
      return storeSlug !== "euronics" || (first !== "en" && first !== "ru");
    } catch {
      return false;
    }
  });
  const source = preferred.length >= limit ? preferred : urls;
  if (source.length <= limit) return source;
  const chosen: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < limit; index += 1) {
    const baseIndex = Math.min(source.length - 1, Math.floor((index * source.length) / limit));
    const url = source[(baseIndex + Math.max(0, Math.floor(offset))) % source.length];
    if (!seen.has(url)) {
      seen.add(url);
      chosen.push(url);
    }
  }
  return chosen;
}

function prioritySample(urls: string[], limit: number, storeSlug: string, offset: number, queries: string[] = []) {
  const priority: string[] = [];
  for (const query of queries) {
    const tokens = query.toLowerCase().match(/[a-z0-9]+/g) || [];
    const compactQuery = tokens.join("");
    const match = urls.find((url) => {
      const compactUrl = decodeURIComponent(url).toLowerCase().replace(/[^a-z0-9]+/g, "");
      return compactQuery.length >= 4 && (compactUrl.includes(compactQuery) || tokens.every((token) => compactUrl.includes(token)));
    });
    if (match && !priority.includes(match)) priority.push(match);
    if (priority.length >= limit) break;
  }
  const remaining = urls.filter((url) => !priority.includes(url));
  return [...priority, ...diverseSample(remaining, limit - priority.length, storeSlug, offset)].slice(0, limit);
}

async function collectPages(store: CollectorStore, candidates: string[], delay: number) {
  const offers: CollectedOffer[] = [];
  const rejectionReasons: Record<string, number> = {};
  for (const url of candidates) {
    try {
      const html = await fetchText(url, 12_000);
      const offer = parseProductPage(html, url, store);
      if (offer) offers.push(offer);
      else increment(rejectionReasons, "missing-product-or-one-time-price");
    } catch (error) {
      increment(rejectionReasons, error instanceof Error && /^\d{3}\s/.test(error.message) ? "http-error" : "fetch-error");
    }
    if (delay) await sleep(delay);
  }
  return { offers, rejected: candidates.length - offers.length, rejectionReasons };
}

export function createDefaultCollectorHandlers(options: DefaultHandlerOptions = {}): CollectorSourceHandlers {
  const maxSitemaps = Math.min(Math.max(options.maxSitemaps ?? 12, 1), 30);
  const maxProductPages = Math.min(Math.max(options.maxProductPages ?? 25, 1), 100);

  return {
    "merchant-feed": async (store) => {
      if (!store.feedUrls?.length) return { source: "merchant-feed", offers: [], note: "no-feed-configured" };
      const offers = [];
      let examined = 0;
      let rejected = 0;
      for (const feedUrl of store.feedUrls) {
        const xml = await fetchText(feedUrl, 20_000);
        const parsed = parseMerchantXmlFeed(xml, store);
        offers.push(...parsed.offers);
        examined += parsed.totalItems;
        rejected += parsed.rejected;
      }
      return { source: "merchant-feed", offers, examined, rejected };
    },

    sitemap: async (store) => {
      const roots = await resolveStoreSitemapUrls(store);
      if (!roots.length) return { source: "sitemap", offers: [], note: "no-public-sitemap" };
      const entries = await expandSitemaps(store, roots, maxSitemaps);
      const allCandidates = entries
        .map((entry) => entry.loc)
        .filter((url) => looksLikeProductUrl(url, store.productUrlHints ?? [], store.slug));
      const candidates = prioritySample(allCandidates, maxProductPages, store.slug, options.sampleOffset ?? 0, options.priorityQueries);

      const delay = Math.max(0, options.pageDelayMs ?? Math.min(store.crawlDelayMs ?? 1000, 500));
      const collected = await collectPages(store, candidates, delay);

      return {
        source: "sitemap",
        offers: collected.offers,
        discovered: entries.length,
        examined: candidates.length,
        rejected: collected.rejected,
        rejectionReasons: collected.rejectionReasons,
        note: `discovered=${entries.length};productCandidates=${allCandidates.length};sampled=${candidates.length}`,
      };
    },

    "catalog-adapter": async (store) => {
      if (!store.catalogUrls?.length) return { source: "catalog-adapter", offers: [], note: "no-catalog-listings-configured" };
      const links = new Set<string>();
      const rejectionReasons: Record<string, number> = {};
      for (const catalogUrl of store.catalogUrls) {
        try {
          const html = await fetchText(catalogUrl, 15_000);
          for (const link of catalogProductLinks(html, catalogUrl, store)) links.add(link);
        } catch {
          increment(rejectionReasons, "listing-fetch-error");
        }
      }
      const candidates = diverseSample([...links], maxProductPages, store.slug, options.sampleOffset);
      const delay = Math.max(0, options.pageDelayMs ?? Math.min(store.crawlDelayMs ?? 1000, 500));
      const collected = await collectPages(store, candidates, delay);
      for (const [key, count] of Object.entries(collected.rejectionReasons)) {
        rejectionReasons[key] = (rejectionReasons[key] || 0) + count;
      }
      return {
        source: "catalog-adapter",
        offers: collected.offers,
        discovered: links.size,
        examined: candidates.length,
        rejected: collected.rejected,
        rejectionReasons,
        note: `listingPages=${store.catalogUrls.length};productLinks=${links.size};sampled=${candidates.length}`,
      };
    },
  };
}
