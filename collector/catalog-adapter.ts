import { adapterProductLinks, merchantAdapters } from "./merchant-adapters.ts";
import { looksLikeProductUrl } from "./sitemap.ts";
import type { CollectorStore } from "./types.ts";

function decodeAttribute(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function belongsToStore(url: URL, store: CollectorStore) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const expected = new URL(store.origin).hostname.toLowerCase().replace(/^www\./, "");
  return host === expected || host.endsWith(`.${expected}`) || expected.endsWith(`.${host}`);
}

/** Extract public product links from a merchant category/listing page. */
export function catalogProductLinks(html: string, pageUrl: string, store: CollectorStore) {
  if (merchantAdapters[store.slug]) return adapterProductLinks(html, pageUrl, store);
  const urls = new Set<string>();
  const baseHref = html.match(/<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
  const linkBase = baseHref ? new URL(decodeAttribute(baseHref), pageUrl).toString() : pageUrl;
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/gi)) {
    const href = decodeAttribute(match[1] || match[2] || "").trim();
    if (!href || href.startsWith("#") || /^(?:javascript|mailto|tel):/i.test(href)) continue;
    try {
      const url = new URL(href, linkBase);
      url.hash = "";
      if (store.slug === "lmt") url.searchParams.delete("payment-type");
      if (!belongsToStore(url, store)) continue;
      if (looksLikeProductUrl(url.toString(), store.productUrlHints ?? [], store.slug)) urls.add(url.toString());
    } catch {
      // A malformed merchant link is ignored without failing the listing.
    }
  }
  return [...urls];
}
