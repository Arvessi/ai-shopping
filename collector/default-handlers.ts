import { fetchText, resolveStoreSitemapUrls, expandSitemaps, sleep } from "./http.ts";
import { parseMerchantXmlFeed } from "./feed.ts";
import { parseProductPage } from "./product-page.ts";
import { looksLikeProductUrl } from "./sitemap.ts";
import type { CollectorSourceHandlers } from "./orchestrator.ts";

export type DefaultHandlerOptions = {
  maxSitemaps?: number;
  maxProductPages?: number;
  pageDelayMs?: number;
};

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
      const candidates = entries
        .map((entry) => entry.loc)
        .filter((url) => looksLikeProductUrl(url, store.productUrlHints ?? [], store.slug))
        .slice(0, maxProductPages);

      const offers = [];
      let rejected = 0;
      const delay = Math.max(0, options.pageDelayMs ?? Math.min(store.crawlDelayMs ?? 1000, 500));
      for (const url of candidates) {
        try {
          const html = await fetchText(url, 12_000);
          const offer = parseProductPage(html, url, store);
          if (offer) offers.push(offer);
          else rejected += 1;
        } catch {
          rejected += 1;
        }
        if (delay) await sleep(delay);
      }

      return {
        source: "sitemap",
        offers,
        examined: candidates.length,
        rejected,
        note: `discovered=${entries.length};candidates=${candidates.length}`,
      };
    },
  };
}
