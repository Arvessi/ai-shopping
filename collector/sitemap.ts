import { XMLParser } from "fast-xml-parser";
import type { SitemapEntry } from "./types.ts";

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

function arrayify<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseSitemapXml(xml: string): {
  kind: "index" | "urlset" | "unknown";
  entries: SitemapEntry[];
} {
  const parsed = parser.parse(xml) as Record<string, any>;

  if (parsed?.sitemapindex?.sitemap) {
    const entries = arrayify(parsed.sitemapindex.sitemap)
      .map((item: any) => ({
        loc: String(item?.loc ?? "").trim(),
        lastmod: item?.lastmod ? String(item.lastmod) : undefined,
      }))
      .filter((item) => item.loc.startsWith("http"));
    return { kind: "index", entries };
  }

  if (parsed?.urlset?.url) {
    const entries = arrayify(parsed.urlset.url)
      .map((item: any) => ({
        loc: String(item?.loc ?? "").trim(),
        lastmod: item?.lastmod ? String(item.lastmod) : undefined,
      }))
      .filter((item) => item.loc.startsWith("http"));
    return { kind: "urlset", entries };
  }

  return { kind: "unknown", entries: [] };
}

export function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function looksLikeProductUrl(url: string, hints: string[] = []): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (!path || path === "/") return false;
    if (hints.length && !hints.some((hint) => path.includes(hint.toLowerCase()))) return false;
    return !/(\/cart|\/checkout|\/login|\/users|\/search|\/compare|\/wishlist)(\/|$)/i.test(path);
  } catch {
    return false;
  }
}
