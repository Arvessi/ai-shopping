import { XMLParser } from "fast-xml-parser";
import { isAllowedCatalogItem } from "./product-page.ts";
import type { CollectedOffer, CollectorStore } from "./types.ts";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
});

type AnyRecord = Record<string, unknown>;

const ITEM_KEYS = new Set(["product", "item", "offer", "entry"]);

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : null;
}

function collectItems(value: unknown, parentKey = ""): AnyRecord[] {
  if (Array.isArray(value)) {
    if (ITEM_KEYS.has(parentKey.toLowerCase())) {
      return value.map(asRecord).filter((x): x is AnyRecord => Boolean(x));
    }
    return value.flatMap((item) => collectItems(item, parentKey));
  }

  const record = asRecord(value);
  if (!record) return [];

  const out: AnyRecord[] = [];
  for (const [key, child] of Object.entries(record)) {
    if (ITEM_KEYS.has(key.toLowerCase())) {
      const values = Array.isArray(child) ? child : [child];
      out.push(...values.map(asRecord).filter((x): x is AnyRecord => Boolean(x)));
    } else {
      out.push(...collectItems(child, key));
    }
  }
  return out;
}

function scalar(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    return text || undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ["#text", "@_value", "value"]) {
    const nested = scalar(record[key]);
    if (nested) return nested;
  }
  return undefined;
}

function pick(item: AnyRecord, aliases: string[]): string | undefined {
  const lower = new Map(Object.entries(item).map(([key, value]) => [key.toLowerCase(), value]));
  for (const alias of aliases) {
    const value = scalar(lower.get(alias.toLowerCase()));
    if (value) return value;
  }
}

function price(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/\s/g, "")
    .replace(/,(?=\d{1,2}(?:\D|$))/, ".")
    .replace(/[^0-9.]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export type FeedImportResult = {
  offers: CollectedOffer[];
  rejected: number;
  totalItems: number;
};

/**
 * Imports common merchant XML feed shapes into CENIQ's normalized offer model.
 * It intentionally supports aliases instead of forcing merchants to build a
 * PriceBee/CENIQ-specific feed before we can test cooperation.
 */
export function parseMerchantXmlFeed(
  xml: string,
  store: CollectorStore,
): FeedImportResult {
  const document = parser.parse(xml) as unknown;
  const items = collectItems(document);
  const offers: CollectedOffer[] = [];
  let rejected = 0;

  for (const item of items) {
    const title = pick(item, ["title", "name", "product_name", "productname"]);
    const url = pick(item, ["url", "link", "product_url", "producturl"]);
    const amount = price(pick(item, ["price", "sale_price", "final_price", "amount"]));
    const currency = (pick(item, ["currency", "price_currency", "currency_code"]) ?? "EUR").toUpperCase();

    if (!title || !url || !url.startsWith("http") || !amount || !isAllowedCatalogItem(`${title} ${url}`)) {
      rejected += 1;
      continue;
    }

    offers.push({
      merchantSlug: store.slug,
      merchantName: store.name,
      merchantCountry: store.country,
      url,
      title,
      price: amount,
      currency,
      imageUrl: pick(item, ["image", "image_url", "imageurl", "picture", "picture_url"]),
      availability: pick(item, ["availability", "stock", "stock_status", "instock"]),
      brand: pick(item, ["brand", "manufacturer", "vendor"]),
      sku: pick(item, ["sku", "merchant_sku", "product_id", "id", "code"]),
      gtin: pick(item, ["gtin", "gtin13", "ean", "ean13", "barcode"]),
      category: pick(item, ["category", "category_name", "product_type"]),
      fetchedAt: new Date().toISOString(),
    });
  }

  return { offers, rejected, totalItems: items.length };
}
