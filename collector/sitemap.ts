import { merchantAdapters } from "./merchant-adapters.ts";
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

function hasSkuLikeSegment(parts: string[]) {
  return parts.some((part) => {
    if (part.length < 6 || part.length > 40) return false;
    return /[a-z]/i.test(part) && /\d/.test(part) && /^[a-z0-9._-]+$/i.test(part);
  });
}

export function looksLikeProductUrl(url: string, hints: string[] = [], storeSlug?: string): boolean {
  try {
    const parsed = new URL(url);
    if (storeSlug && merchantAdapters[storeSlug]) return merchantAdapters[storeSlug].isProduct(parsed);
    const path = parsed.pathname.toLowerCase();
    const parts = path.split("/").filter(Boolean);
    if (!path || path === "/") return false;
    if (/(\/cart|\/checkout|\/login|\/users|\/search|\/compare|\/wishlist)(\/|$)/i.test(path)) return false;

    // Euronics product pages are deep category URLs with a SKU/model code segment,
    // e.g. /telefoni/viedtalruni/android/sm-a165fzkbeue/product-name.
    if (storeSlug === "euronics") {
      return parts.length >= 5 && hasSkuLikeSegment(parts);
    }

    // LMT catalogue product pages live below /veikals/<category>/<model> and
    // variants can add another segment. Category landing pages stop at 2 parts.
    if (storeSlug === "lmt") {
      return parts[0] === "veikals" && parts.length >= 3 && parts.at(-1) !== "salidzini";
    }

    if (storeSlug === "tele2") {
      return parts[0] === "telefoni" && parts.length >= 2;
    }

    if (storeSlug === "tet") {
      return parts[0] === "veikals" && parts.length >= 3 && /\.html$/i.test(parts.at(-1) || "");
    }

    // Bite device pages use /lv/<device-category>/<product-slug>. Keep this
    // deliberately narrow so sitemap sampling does not waste parser budget on
    // service/content pages. We can expand categories as we validate them.
    if (storeSlug === "bite") {
      const category = parts[1];
      const productCategories = new Set([
        "telefoni",
        "viedpulksteni",
        "planšetdatori",
        "datori",
        "rūteri",
        "ruteri",
        "aksesuari",
      ]);
      return parts[0] === "lv" && parts.length >= 3 && productCategories.has(category || "");
    }

    if (hints.length) return hints.some((hint) => path.includes(hint.toLowerCase()));
    return /(?:\/products?\/|\/produkts?\/|\/prece\/|\/item\/)/i.test(path) || (parts.length >= 3 && hasSkuLikeSegment(parts));
  } catch {
    return false;
  }
}
