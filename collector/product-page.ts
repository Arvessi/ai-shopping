import type { CollectedOffer, CollectorStore } from "./types.ts";

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function meta(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1].trim());
  }
}

function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(regex)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Invalid merchant JSON-LD must not kill the collector.
    }
  }
  return out;
}

function flattenJsonLd(value: unknown): Record<string, any>[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (typeof value !== "object") return [];
  const record = value as Record<string, any>;
  const nested = record["@graph"] ? flattenJsonLd(record["@graph"]) : [];
  return [record, ...nested];
}

function productNode(html: string): Record<string, any> | undefined {
  return jsonLdBlocks(html)
    .flatMap(flattenJsonLd)
    .find((node) => {
      const type = node["@type"];
      return Array.isArray(type) ? type.includes("Product") : type === "Product";
    });
}

function firstOffer(node: Record<string, any> | undefined): Record<string, any> | undefined {
  const offers = node?.offers;
  if (Array.isArray(offers)) return offers.find((offer) => offer && typeof offer === "object");
  return offers && typeof offers === "object" ? offers : undefined;
}

function numericPrice(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s/g, "").replace(",", ".").replace(/[^0-9.]/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

const blockedCatalogTerms = [
  /\b(ammunition|firearm|rifle|shotgun|handgun)\b/i,
  /\b(vape|e-cigarette|nicotine)\b/i,
  /\b(casino|sportsbook|betting)\b/i,
  /\b(vodka|whisky|whiskey|beer|wine)\b/i,
];

export function isAllowedCatalogItem(text: string): boolean {
  return !blockedCatalogTerms.some((pattern) => pattern.test(text));
}

export function parseProductPage(
  html: string,
  url: string,
  store: CollectorStore,
): CollectedOffer | null {
  const product = productNode(html);
  const offer = firstOffer(product);

  const title = String(product?.name ?? meta(html, "og:title") ?? "").trim();
  const price = numericPrice(
    offer?.price ?? offer?.lowPrice ?? meta(html, "product:price:amount") ?? meta(html, "og:price:amount"),
  );
  const currency = String(
    offer?.priceCurrency ?? meta(html, "product:price:currency") ?? meta(html, "og:price:currency") ?? "EUR",
  ).toUpperCase();

  if (!title || !price || !isAllowedCatalogItem(`${title} ${url}`)) return null;

  const image = product?.image;
  const imageUrl = Array.isArray(image)
    ? String(image[0] ?? "")
    : typeof image === "object" && image
      ? String(image.url ?? image.contentUrl ?? "")
      : String(image ?? meta(html, "og:image") ?? "");

  const brand = typeof product?.brand === "object" ? product.brand?.name : product?.brand;
  const gtin = product?.gtin13 ?? product?.gtin14 ?? product?.gtin12 ?? product?.gtin8 ?? product?.gtin;

  return {
    merchantSlug: store.slug,
    merchantName: store.name,
    merchantCountry: store.country,
    url,
    title,
    price,
    currency,
    imageUrl: imageUrl || undefined,
    availability: offer?.availability ? String(offer.availability) : undefined,
    brand: brand ? String(brand) : undefined,
    sku: product?.sku ? String(product.sku) : undefined,
    gtin: gtin ? String(gtin) : undefined,
    category: product?.category ? String(product.category) : undefined,
    fetchedAt: new Date().toISOString(),
  };
}
