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

function h1(html: string): string | undefined {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match?.[1]) return undefined;
  return decodeHtml(match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function plainText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&euro;/gi, "€")
      .replace(/\s+/g, " "),
  );
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

function lmtOneTimePrice(html: string): number | undefined {
  const text = plainText(html);
  const match = text.match(/Pērkot uzreiz[\s\S]{0,180}?(\d{1,5}(?:[.,]\d{1,2})?)\s*€/i);
  return numericPrice(match?.[1]);
}

function lmtModel(html: string): string | undefined {
  const text = plainText(html);
  return text.match(/Modelis\s+([A-Z0-9][A-Z0-9._\/-]{4,})/i)?.[1];
}

function biteOneTimePrice(html: string): number | undefined {
  const text = plainText(html);
  const match = text.match(/Pērkot\s+uzreiz[\s\S]{0,160}?(\d{1,5}(?:[.,]\d{1,2})?)\s*€/i);
  return numericPrice(match?.[1]);
}

function biteSku(html: string): string | undefined {
  const text = plainText(html);
  return text.match(/SKU\s+kods\s*:\s*([A-Z0-9._\/-]{4,})/i)?.[1];
}

function m79ConsumerPrice(html: string): number | undefined {
  const text = plainText(html);

  // M79 renders the consumer/gross price immediately before "Bez PVN" and then
  // shows the lower net price. Anchor on that phrase so the net value can never
  // become CENIQ's displayed offer price.
  const grossBeforeVat = text.match(/(\d{1,5}(?:[.,]\d{1,2})?)\s*€\s*Bez\s+PVN\s+\d{1,5}(?:[.,]\d{1,2})?\s*€/i);
  if (grossBeforeVat?.[1]) return numericPrice(grossBeforeVat[1]);

  return undefined;
}

function m79Sku(url: string, title: string): string | undefined {
  const urlMatch = url.match(/-(\d{6,14})(?:\?.*)?$/);
  if (urlMatch?.[1]) return urlMatch[1];
  return title.match(/\((\d{6,14})\)/)?.[1];
}

const blockedCatalogTerms = [
  /\b(ammunition|firearm|rifle|shotgun|handgun|gun|weapon|knife|machete|switchblade|taser|pepper spray|mace)\b/i,
  /\b(vape|e-cigarette|nicotine|cigarette|cigar)\b/i,
  /\b(casino|sportsbook|betting|prediction market)\b/i,
  /\b(vodka|whisky|whiskey|beer|wine|rum|gin|tequila)\b/i,
  /\b(cannabis|marijuana|thc|cbd|psychedelic|magic mushroom)\b/i,
  /\b(steroid|anabolic|dnp diet)\b/i,
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

  const pageH1 = h1(html);
  const title = String(
    product?.name ??
      (store.slug === "bite" ? pageH1 : undefined) ??
      meta(html, "og:title") ??
      pageH1 ??
      "",
  ).trim();
  const structuredPrice = numericPrice(
    offer?.price ??
      offer?.lowPrice ??
      meta(html, "product:price:amount") ??
      meta(html, "og:price:amount"),
  );
  const fallbackPrice = store.slug === "lmt"
    ? lmtOneTimePrice(html)
    : store.slug === "bite"
      ? biteOneTimePrice(html)
      : store.slug === "m79"
        ? m79ConsumerPrice(html)
        : undefined;
  const price = structuredPrice ?? fallbackPrice;
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
  const sku = product?.sku
    ? String(product.sku)
    : store.slug === "lmt"
      ? lmtModel(html)
      : store.slug === "bite"
        ? biteSku(html)
        : store.slug === "m79"
          ? m79Sku(url, title)
          : undefined;

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
    sku,
    gtin: gtin ? String(gtin) : undefined,
    category: product?.category ? String(product.category) : undefined,
    fetchedAt: new Date().toISOString(),
  };
}
