import { createHash } from 'crypto';
import { prisma } from '@/lib/db';
import {
  canonicalizeProductTitle,
  extractVariantData,
} from '@/lib/dataforseo';
import { projectFamilyToLegacy } from '@/lib/catalog';
import {
  LATVIA_ELECTRONICS_STORES,
  type StoreSeed,
} from '@/lib/store-registry';
import type { VariantAttributes } from '@/lib/types';

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';
const USER_AGENT = 'CENIQBot/3.4 (+https://ceniq.lv)';
const DISCOVERY_SUCCESS_CACHE_HOURS = 6;
const DISCOVERY_EMPTY_CACHE_MINUTES = 30;
const PAGE_TIMEOUT_MS = 3200;
const MAX_URLS_TOTAL = 18;
const MAX_URLS_PER_STORE = 3;

const INSTALLMENT =
  /(?:\/\s*mēn|€\s*\/\s*mēn|mēnesī|mēneš|\/\s*mo\b|per\s+month|monthly|nomaks|līzing|leasing|installment|abonē|subscription|pirm[aā]\s+iemaksa|down\s+payment|deposit|tarifs?)/i;

const USED =
  /\b(used|refurbished|renewed|reconditioned|open[\s-]?box|demo|lietots|lietota|atjaunots|atjaunota|mazlietots|vitrīnas)\b/i;

const OUT_OF_STOCK =
  /\b(izpārdots|nav noliktavā|nav pieejams|out of stock|sold out|unavailable)\b/i;

const MODEL_MODIFIERS = [
  'pro',
  'max',
  'plus',
  'ultra',
  'fe',
  'edge',
  'fold',
  'flip',
  'lite',
  'case',
  'cover',
  'glass',
  'charger',
  'adapter',
  'cable',
];

const COLOR_MAP: Array<[RegExp, string]> = [
  [/\b(melna|melns|black|midnight|obsidian|graphite)\b/i, 'Black'],
  [/\b(balta|balts|white|starlight)\b/i, 'White'],
  [/\b(rozā|pink|rose)\b/i, 'Pink'],
  [/\b(zilganzaļa|teal|mint)\b/i, 'Teal'],
  [/\b(ultramarine|zila|zils|blue|navy)\b/i, 'Blue'],
  [/\b(zaļa|zaļš|green)\b/i, 'Green'],
  [/\b(sarkana|sarkans|red)\b/i, 'Red'],
  [/\b(dzeltena|dzeltens|yellow)\b/i, 'Yellow'],
  [/\b(violeta|violets|purple|violet)\b/i, 'Purple'],
  [/\b(pelēka|pelēks|gray|grey)\b/i, 'Gray'],
  [/\b(sudraba|silver)\b/i, 'Silver'],
  [/\b(zelta|gold)\b/i, 'Gold'],
];

type DiscoveredPage = {
  url: string;
  title?: string;
  snippet?: string;
  domain: string;
  store: StoreSeed;
  score: number;
  query: string;
  price?: number;
  currency?: string;
  image?: string;
};

type ParsedOffer = {
  store: StoreSeed;
  title: string;
  url: string;
  image?: string;
  brand?: string;
  model?: string;
  category?: string;
  gtin?: string;
  mpn?: string;
  sku?: string;
  price: number;
  oldPrice?: number;
  currency: string;
  availability?: string;
  variantData: VariantAttributes;
  condition: string;
};

function hash(value: string) {
  return createHash('sha1').update(value).digest('hex');
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/(\d+)\s+(gb|tb)\b/gi, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeUrl(value?: string | null, base?: string) {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function host(value: string) {
  const url = safeUrl(value.includes('://') ? value : `https://${value}`);
  return url?.hostname.replace(/^www\./i, '').toLowerCase() || '';
}

function sameDomain(value: string, domain: string) {
  const actual = host(value);
  const allowed = domain.replace(/^www\./i, '').toLowerCase();
  return (
    actual === allowed ||
    actual.endsWith(`.${allowed}`) ||
    allowed.endsWith(`.${actual}`)
  );
}

function stripTags(value: string) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMeta(html: string, keys: string[]) {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        'i',
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*>`,
        'i',
      ),
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return match[1].replace(/&amp;/g, '&').trim();
    }
  }
  return undefined;
}

function firstH1(html: string) {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return match?.[1] ? stripTags(match[1]) : undefined;
}

function numeric(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (value == null) return undefined;

  const raw = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s/g, '')
    .replace(/[^\d,.-]/g, '');

  if (!raw) return undefined;

  let normalized = raw;

  if (raw.includes(',') && raw.includes('.')) {
    normalized =
      raw.lastIndexOf(',') > raw.lastIndexOf('.')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.replace(/,/g, '');
  } else if (raw.includes(',')) {
    normalized = raw.replace(',', '.');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}


function rawSearchPrice(item: Record<string, any>) {
  const price = item.price;
  const displayed =
    typeof price === 'object'
      ? String(price?.displayed_price || '')
      : '';

  const combined = `${item.title || ''} ${item.description || ''} ${item.snippet || ''} ${displayed}`;

  const candidates = [
    numeric(item.total_price),
    numeric(item.base_price),
    typeof price === 'object' ? numeric(price?.current) : numeric(price),
    typeof price === 'object' ? numeric(price?.regular) : undefined,
    typeof price === 'object' ? numeric(price?.max_value) : undefined,
    numeric(item.old_price),
  ].filter((value): value is number => Boolean(value && value > 0));

  const multiplier = numeric(item.price_multiplier);
  const current =
    typeof price === 'object' ? numeric(price?.current) : numeric(price);

  if (multiplier && multiplier > 1 && current) {
    candidates.push(current * multiplier);
  }

  if (!candidates.length) return undefined;

  if (INSTALLMENT.test(combined)) {
    const fullPrice = candidates.filter((value) => !current || value > current * 2.2);
    return fullPrice.length ? Math.max(...fullPrice) : undefined;
  }

  const total = numeric(item.total_price);
  if (total) return total;

  const base = numeric(item.base_price);
  if (base) return base;

  return current || Math.min(...candidates);
}

function inferBrand(title: string) {
  const value = title.toLowerCase();

  if (/\biphone\b|\bipad\b|\bmacbook\b|\bairpods\b|\bapple watch\b/i.test(title)) {
    return 'Apple';
  }
  if (/\bgalaxy\b/i.test(title)) return 'Samsung';
  if (/\bpixel\b/i.test(title)) return 'Google';

  const known = [
    'Apple',
    'Samsung',
    'Google',
    'Xiaomi',
    'Huawei',
    'Honor',
    'OnePlus',
    'Nothing',
    'Sony',
    'LG',
    'Philips',
    'Panasonic',
    'Lenovo',
    'Asus',
    'Acer',
    'Dell',
    'HP',
    'MSI',
    'Microsoft',
    'JBL',
    'Bose',
    'Marshall',
    'Logitech',
    'Razer',
    'Corsair',
    'SteelSeries',
    'Canon',
    'Nikon',
    'Fujifilm',
    'GoPro',
    'DJI',
    'Garmin',
    'Bosch',
    'Dyson',
    'Roborock',
  ];

  return known.find((brand) => value.includes(brand.toLowerCase()));
}

function storageFromText(text: string) {
  const labelled = text.match(
    /(?:iekšējā atmiņa|iebūvētā atmiņa|atmiņa|storage|capacity)[^0-9]{0,60}(64|128|256|512|1024)\s*gb/i,
  );
  if (labelled) return `${labelled[1]}GB`;

  const match = text.match(/\b(64|128|256|512|1024)\s*GB\b/i);
  return match ? `${match[1]}GB` : undefined;
}

function ramFromText(text: string) {
  const match = text.match(
    /(?:operatīvā atmiņa|ram|memory ram)[^0-9]{0,40}(\d{1,3})\s*gb/i,
  );
  return match ? `${match[1]}GB` : undefined;
}

function colorFromText(text: string) {
  const labelled = text.match(
    /(?:krāsa|colour|color)\s*:?\s*([A-Za-zĀ-ž -]{3,30})/i,
  );
  const scope = labelled?.[1] || text;

  for (const [pattern, label] of COLOR_MAP) {
    if (pattern.test(scope)) return label;
  }

  return undefined;
}

function compactVariantData(
  title: string,
  extraText = '',
): VariantAttributes {
  const base = extractVariantData(title);
  const combined = `${title} ${extraText}`;

  return {
    storage: base.storage || storageFromText(combined),
    color: base.color || colorFromText(combined),
    ram: base.ram || ramFromText(combined),
    connectivity: base.connectivity,
    size: base.size,
    condition: USED.test(combined) ? 'Refurbished / Used' : 'New',
  };
}

function variantKey(data: VariantAttributes, gtin?: string, mpn?: string, sku?: string) {
  if (gtin) return `gtin:${gtin}`;

  const attrs = Object.entries(data)
    .filter(
      ([key, value]) =>
        Boolean(value) && !(key === 'condition' && value === 'New'),
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${normalize(String(value))}`)
    .join('|');

  if (attrs) return `attrs:${hash(attrs)}`;
  if (mpn) return `mpn:${normalize(mpn)}`;
  if (sku) return `sku:${normalize(sku)}`;
  return `base:${hash('base')}`;
}

function queryTokens(query: string) {
  const budgetNumbers = new Set(
    Array.from(
      query.matchAll(
        /(?:līdz|lid[zž]|zem|under|max(?:imum)?|budžets?|budget)\s*[:<]?\s*(\d{2,5})|(?:^|\s)(\d{2,5})\s*(?:€|eur)\b/gi,
      ),
    )
      .map((match) => match[1] || match[2])
      .filter(Boolean),
  );

  return normalize(query)
    .split(' ')
    .filter((token) => token.length >= 2)
    .filter((token) => !budgetNumbers.has(token))
    .filter(
      (token) =>
        ![
          'apple',
          'samsung',
          'google',
          'telefons',
          'phone',
          'smartphone',
          'pirkt',
          'cena',
          'price',
          'līdz',
          'lid',
          'zem',
          'under',
          'budget',
          'budžets',
        ].includes(token),
    );
}

function titleMatchesQuery(title: string, query: string) {
  const titleNorm = normalize(title);
  const queryNorm = normalize(query);
  const wanted = queryTokens(query);
  const titleTokens = new Set(titleNorm.split(' ').filter(Boolean));

  if (!wanted.length) return true;

  const tokenMatches = (token: string) => {
    if (/\d/.test(token)) {
      if (/^(?:64|128|256|512|1024)(?:gb|tb)$/.test(token)) {
        const wantedStorage = storageFromText(token);
        const actualStorage = storageFromText(title);
        return !wantedStorage || !actualStorage || wantedStorage === actualStorage;
      }

      return titleTokens.has(token);
    }

    return titleNorm.includes(token);
  };

  const matched = wanted.filter(tokenMatches).length;
  const numericMiss = wanted
    .filter((token) => /\d/.test(token))
    .some((token) => !tokenMatches(token));

  if (numericMiss) return false;
  if (matched / wanted.length < 0.72) return false;

  for (const modifier of MODEL_MODIFIERS) {
    const titleHas = new RegExp(`\\b${modifier}\\b`, 'i').test(titleNorm);
    const queryHas = new RegExp(`\\b${modifier}\\b`, 'i').test(queryNorm);
    if (titleHas && !queryHas) return false;
  }

  const wantedStorage = storageFromText(query);
  const titleStorage = storageFromText(title);
  if (wantedStorage && titleStorage && wantedStorage !== titleStorage) {
    return false;
  }

  return true;
}

function relevance(title: string, query: string) {
  if (!titleMatchesQuery(title, query)) return -100;

  const wanted = queryTokens(query);
  const normTitle = normalize(title);
  let score = 0;

  for (const token of wanted) {
    if (normTitle.includes(token)) score += /\d/.test(token) ? 8 : 5;
  }

  score -= Math.max(0, normTitle.split(' ').length - wanted.length - 2);
  return score;
}

function fullPriceCandidates(text: string) {
  const values: Array<{ value: number; rank: number }> = [];

  const labelled = [
    /(?:pilna summa|pērkot uzreiz|pirkt uzreiz|pay now|preces cena|cena|price)\b[\s\S]{0,120}?([0-9][0-9\s.,]{0,12})\s*€/gi,
    /([0-9][0-9\s.,]{0,12})\s*€[\s\S]{0,80}?(?:pērkot uzreiz|pay now|pilna summa)/gi,
  ];

  for (const pattern of labelled) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) && values.length < 24) {
      const value = numeric(match[1]);
      if (value && value > 0 && value < 100_000) {
        const around = text.slice(
          Math.max(0, match.index - 70),
          Math.min(text.length, pattern.lastIndex + 70),
        );
        if (!INSTALLMENT.test(around)) {
          values.push({ value, rank: 10 });
        }
      }
    }
  }

  const euro = /([0-9][0-9\s]{0,8}(?:[.,][0-9]{1,2})?)\s*€/g;
  let match: RegExpExecArray | null;

  while ((match = euro.exec(text)) && values.length < 80) {
    const value = numeric(match[1]);
    if (!value || value <= 0 || value >= 100_000) continue;

    const around = text.slice(
      Math.max(0, match.index - 80),
      Math.min(text.length, euro.lastIndex + 80),
    );

    if (
      INSTALLMENT.test(around) ||
      /(?:piegāde|delivery|shipping|apdrošin|insurance|garantija|warranty|bez pvn|without vat)/i.test(
        around,
      )
    ) {
      continue;
    }

    values.push({ value, rank: 1 });
  }

  if (!values.length) return [];

  const highRank = values.filter((item) => item.rank >= 10);
  const pool = highRank.length ? highRank : values;

  return Array.from(new Set(pool.map((item) => item.value))).sort(
    (a, b) => a - b,
  );
}

function likelyFullPrice(text: string) {
  const values = fullPriceCandidates(text);
  if (!values.length) return undefined;

  const max = Math.max(...values);
  const plausible = values.filter((value) => value >= max * 0.42);
  return Math.min(...(plausible.length ? plausible : values));
}

function imageAround(html: string, pageUrl: string) {
  const meta = firstMeta(html, ['og:image', 'twitter:image', 'image']);
  if (meta) return safeUrl(meta, pageUrl)?.toString();

  const imageMatch = html.match(
    /<img\b[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/i,
  );
  return imageMatch?.[1]
    ? safeUrl(imageMatch[1], pageUrl)?.toString()
    : undefined;
}

function jsonLdScripts(html: string) {
  const output: any[] = [];
  const regex =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) && output.length < 20) {
    const raw = match[1]
      .replace(/^\s*<!--/, '')
      .replace(/-->\s*$/, '')
      .trim();
    if (!raw) continue;
    try {
      output.push(JSON.parse(raw));
    } catch {
      // Ignore malformed structured data from a merchant page.
    }
  }

  return output;
}

function collectJsonLdProducts(value: any, output: any[] = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectJsonLdProducts(child, output);
    return output;
  }

  if (!value || typeof value !== 'object') return output;

  const rawType = value['@type'];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  if (
    types.some((type) => String(type || '').toLowerCase() === 'product')
  ) {
    output.push(value);
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      collectJsonLdProducts(child, output);
    }
  }

  return output;
}

function firstString(value: any): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    for (const child of value) {
      const result = firstString(child);
      if (result) return result;
    }
  }
  if (value && typeof value === 'object') {
    return firstString(value.url || value.contentUrl || value.name || value.value);
  }
  return undefined;
}

function jsonLdOffer(product: any) {
  const raw = product?.offers;
  const offers = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const candidates: Array<{ offer: any; price: number }> = [];

  for (const offer of offers) {
    const nested = Array.isArray(offer?.offers) ? offer.offers : [];
    for (const item of [offer, ...nested]) {
      const price = numeric(
        item?.price ??
          item?.lowPrice ??
          item?.priceSpecification?.price,
      );
      if (price && price > 0) candidates.push({ offer: item, price });
    }
  }

  return candidates.sort((a, b) => a.price - b.price)[0] || null;
}

function parseJsonLdProducts(
  html: string,
  pageUrl: string,
  store: StoreSeed,
  query: string,
): ParsedOffer[] {
  const products = jsonLdScripts(html).flatMap((script) =>
    collectJsonLdProducts(script),
  );

  const pageText = stripTags(html).slice(0, 250_000);
  const results: ParsedOffer[] = [];

  for (const product of products.slice(0, 12)) {
    const title = firstString(product?.name);
    if (!title || !titleMatchesQuery(title, query)) continue;

    const chosen = jsonLdOffer(product);
    const fallbackPrice = likelyFullPrice(pageText);
    const price = chosen?.price || fallbackPrice;
    if (!price || price <= 0) continue;

    const url =
      safeUrl(
        firstString(chosen?.offer?.url ?? product?.url) || pageUrl,
        pageUrl,
      )?.toString() || pageUrl;

    const image = safeUrl(
      firstString(product?.image ?? chosen?.offer?.image),
      pageUrl,
    )?.toString();

    const brand =
      firstString(product?.brand?.name ?? product?.brand) ||
      inferBrand(title);

    const gtin = firstString(
      product?.gtin13 ??
        product?.gtin14 ??
        product?.gtin12 ??
        product?.gtin8 ??
        product?.gtin,
    )?.replace(/\D/g, '');

    const mpn = firstString(product?.mpn);
    const sku = firstString(product?.sku);

    const variantData = compactVariantData(title, pageText.slice(0, 80_000));

    results.push({
      store,
      title,
      url,
      image,
      brand,
      gtin,
      mpn,
      sku,
      price,
      currency:
        firstString(
          chosen?.offer?.priceCurrency ??
            product?.offers?.priceCurrency,
        ) || 'EUR',
      availability: firstString(chosen?.offer?.availability),
      variantData,
      condition: variantData.condition || 'New',
    });
  }

  return results;
}

function parseDetailFallback(
  html: string,
  pageUrl: string,
  store: StoreSeed,
  query: string,
): ParsedOffer[] {
  const text = stripTags(html).slice(0, 320_000);
  const title =
    firstMeta(html, ['og:title', 'twitter:title']) || firstH1(html);

  if (!title || !titleMatchesQuery(title, query)) return [];

  const price = likelyFullPrice(text);
  if (!price || price <= 0) return [];

  const variantData = compactVariantData(title, text.slice(0, 90_000));

  const mpn =
    text.match(/\b(?:MPN|Modelis|Model)\s*:?\s*([A-Z0-9][A-Z0-9/-]{4,})/i)?.[1] ||
    undefined;

  const gtin =
    text.match(/\b(?:EAN|GTIN)\s*:?\s*(\d{8,14})\b/i)?.[1] || undefined;

  let availability: string | undefined;
  if (/\b(ir noliktavā|pieejams noliktavā|in stock|pieejams)\b/i.test(text)) {
    availability = 'Pieejams';
  } else if (/\b(tikai veikalos|only available in shops)\b/i.test(text)) {
    availability = 'Pieejams veikalos';
  } else if (OUT_OF_STOCK.test(text)) {
    availability = 'Nav pieejams';
  }

  return [
    {
      store,
      title,
      url: pageUrl,
      image: imageAround(html, pageUrl),
      brand: inferBrand(title),
      gtin,
      mpn,
      price,
      currency:
        firstMeta(html, [
          'product:price:currency',
          'og:price:currency',
          'priceCurrency',
        ]) || 'EUR',
      availability,
      variantData,
      condition: variantData.condition || 'New',
    },
  ];
}

function parseListingProducts(
  html: string,
  pageUrl: string,
  store: StoreSeed,
  query: string,
): ParsedOffer[] {
  const results: ParsedOffer[] = [];
  const anchor =
    /<a\b([^>]*)href=["']([^"'#]+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchor.exec(html)) && results.length < 18) {
    const title = stripTags(match[4]);
    if (title.length < 5 || !titleMatchesQuery(title, query)) continue;

    const url = safeUrl(match[2], pageUrl);
    if (!url || !sameDomain(url.toString(), store.domain)) continue;

    const start = Math.max(0, match.index - 900);
    const end = Math.min(html.length, anchor.lastIndex + 2400);
    const windowHtml = html.slice(start, end);
    const windowText = stripTags(windowHtml);

    const price = likelyFullPrice(windowText);
    if (!price || price <= 0) continue;

    if (
      OUT_OF_STOCK.test(windowText.slice(0, 1200)) &&
      !/\b(pieejams|in stock|noliktavā)\b/i.test(windowText.slice(0, 1200))
    ) {
      continue;
    }

    const variantData = compactVariantData(title, windowText.slice(0, 1800));

    results.push({
      store,
      title,
      url: url.toString(),
      image: imageAround(windowHtml, pageUrl),
      brand: inferBrand(title),
      mpn:
        title.match(/\b([A-Z0-9]{5,}[A-Z0-9/-]*\/[A-Z0-9/-]+)\b/)?.[1] ||
        undefined,
      price,
      currency: 'EUR',
      availability: /\b(pieejams|in stock|noliktavā)\b/i.test(windowText)
        ? 'Pieejams'
        : undefined,
      variantData,
      condition: variantData.condition || 'New',
    });
  }

  const best = new Map<string, ParsedOffer>();

  for (const item of results) {
    const key = `${item.url}|${item.price}`;
    const existing = best.get(key);
    if (!existing || relevance(item.title, query) > relevance(existing.title, query)) {
      best.set(key, item);
    }
  }

  return Array.from(best.values())
    .sort((a, b) => relevance(b.title, query) - relevance(a.title, query))
    .slice(0, 10);
}

function familyTitleFor(title: string, brand?: string) {
  let value = canonicalizeProductTitle(title) || title;

  value = value
    .replace(
      /\b(mobilais telefons|viedtālrunis|viedtalrunis|smartphone|mobile phone|telefons|laptop|portatīvais dators)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (!brand) return value;

  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  value = value
    .replace(new RegExp(`^${escaped}\\s+`, 'i'), '')
    .replace(new RegExp(`\\s+${escaped}$`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim();

  return `${brand} ${value}`.replace(/\s+/g, ' ').trim();
}

function familyKeyFor(title: string, brand?: string) {
  return normalize(familyTitleFor(title, brand));
}

function discoveryAuthHeader() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    throw new Error('DataForSEO credentials are not configured.');
  }

  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;
}

async function discoverApprovedPages(query: string): Promise<DiscoveredPage[]> {
  const sources = await prisma.crawlSource.findMany({
    where: { active: true },
    select: {
      slug: true,
      robotsAllowed: true,
    },
  });

  const robots = new Map<string, boolean | null>(
    sources.map((item: { slug: string; robotsAllowed: boolean | null }) => [
      item.slug,
      item.robotsAllowed,
    ]),
  );

  const usableStores = LATVIA_ELECTRONICS_STORES.filter(
    (store) => store.enabled !== false,
  );

  const groups: StoreSeed[][] = [];
  for (let i = 0; i < usableStores.length; i += 13) {
    groups.push(usableStores.slice(i, i + 13));
  }

  const tasks = groups.slice(0, 2).map((stores) => ({
    location_name: process.env.DATAFORSEO_LOCATION_NAME || 'Latvia',
    language_code: process.env.DATAFORSEO_LANGUAGE_CODE || 'en',
    keyword: `${query} (${stores
      .map((store) => `site:${store.domain}`)
      .join(' OR ')})`,
    device: 'desktop',
    os: 'windows',
    depth: 20,
  }));

  const response = await fetch(
    `${DATAFORSEO_BASE}/serp/google/organic/live/advanced`,
    {
      method: 'POST',
      headers: {
        Authorization: discoveryAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tasks),
      cache: 'no-store',
    },
  );

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      json?.status_message ||
        `Store discovery failed (${response.status}).`,
    );
  }

  const pages: DiscoveredPage[] = [];

  function walk(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (!value || typeof value !== 'object') return;

    const item = value as Record<string, any>;
    const url = safeUrl(item.url || item.shopping_url);
    const title = String(item.title || '').trim();
    const snippet = String(item.description || item.snippet || '').trim();

    if (url && title) {
      const store = usableStores.find((candidate) =>
        sameDomain(url.toString(), candidate.domain),
      );

      if (store && titleMatchesQuery(`${title} ${snippet}`, query)) {
        const discoveredPrice = rawSearchPrice(item);

        pages.push({
          url: url.toString(),
          title,
          snippet,
          domain: store.domain,
          store,
          score: relevance(`${title} ${snippet}`, query),
          query,
          price: discoveredPrice,
          currency:
            String(
              item.currency ||
                (typeof item.price === 'object'
                  ? item.price?.currency
                  : '') ||
                'EUR',
            ).toUpperCase(),
          image:
            safeUrl(
              item.image_url ||
                item.product_images?.[0] ||
                item.images?.[0]?.image_url,
              url.toString(),
            )?.toString() || undefined,
        });
      }
    }

    Object.values(item).forEach((child) => {
      if (child && typeof child === 'object') walk(child);
    });
  }

  walk(json?.tasks || []);

  const byStore = new Map<string, DiscoveredPage[]>();

  for (const page of pages) {
    const list = byStore.get(page.store.slug) || [];
    if (!list.some((existing) => existing.url === page.url)) {
      list.push(page);
    }
    byStore.set(page.store.slug, list);
  }

  const selected: DiscoveredPage[] = [];

  const storesByPriority = [...usableStores].sort(
    (a, b) => b.priority - a.priority,
  );

  for (const store of storesByPriority) {
    const list = (byStore.get(store.slug) || []).sort(
      (a, b) => b.score - a.score,
    );

    selected.push(...list.slice(0, MAX_URLS_PER_STORE));

    if (selected.length >= MAX_URLS_TOTAL) break;
  }

  return selected.slice(0, MAX_URLS_TOTAL);
}

function parseRobots(body: string) {
  const lines = body.split(/\r?\n/);
  let applies = false;
  const rules: Array<{ allow: boolean; path: string }> = [];

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;

    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === 'user-agent') {
      applies = value === '*' || /ceniqbot/i.test(value);
      continue;
    }

    if (applies && (key === 'allow' || key === 'disallow') && value) {
      rules.push({ allow: key === 'allow', path: value.replace(/\*.*$/, '') });
    }
  }

  return rules;
}

function robotsAllows(pathname: string, rules: Array<{ allow: boolean; path: string }>) {
  let winner: { allow: boolean; length: number } | null = null;

  for (const rule of rules) {
    if (!rule.path || !pathname.startsWith(rule.path)) continue;

    if (
      !winner ||
      rule.path.length > winner.length ||
      (rule.path.length === winner.length && rule.allow)
    ) {
      winner = { allow: rule.allow, length: rule.path.length };
    }
  }

  return winner?.allow ?? true;
}

async function canFetchStorePage(store: StoreSeed, url: string) {
  const source = await prisma.crawlSource.findUnique({
    where: { slug: store.slug },
    select: {
      id: true,
      robotsAllowed: true,
    },
  });

  if (source?.robotsAllowed === false) return false;

  const target = safeUrl(url);
  if (!target) return false;

  if (source?.robotsAllowed === true) return true;

  try {
    const response = await fetch(new URL('/robots.txt', store.origin), {
      headers: { 'User-Agent': USER_AGENT },
      cache: 'no-store',
      signal: AbortSignal.timeout(3500),
    });

    if (response.status === 401 || response.status === 403) {
      if (source) {
        await prisma.crawlSource.update({
          where: { id: source.id },
          data: {
            robotsAllowed: false,
            robotsCheckedAt: new Date(),
            lastError: `robots.txt returned ${response.status}`,
          },
        });
      }
      return false;
    }

    if (!response.ok) return true;

    const rules = parseRobots(await response.text());
    const allowed = robotsAllows(target.pathname, rules);

    if (source) {
      await prisma.crawlSource.update({
        where: { id: source.id },
        data: {
          robotsAllowed: allowed ? true : false,
          robotsCheckedAt: new Date(),
          lastError: allowed ? null : 'Blocked by robots.txt',
        },
      });
    }

    return allowed;
  } catch {
    return true;
  }
}


function discoveredPageOffer(page: DiscoveredPage): ParsedOffer | null {
  const title = String(page.title || '').trim();

  if (!title || !page.price || !titleMatchesQuery(title, page.query)) {
    return null;
  }

  const combined = `${title} ${page.snippet || ''}`;

  if (INSTALLMENT.test(combined) && page.price < 150) {
    return null;
  }

  const variantData = compactVariantData(title, page.snippet || '');

  return {
    store: page.store,
    title,
    url: page.url,
    image: page.image,
    brand: inferBrand(title),
    price: page.price,
    currency: page.currency || 'EUR',
    availability: OUT_OF_STOCK.test(page.snippet || '')
      ? 'Nav pieejams'
      : undefined,
    variantData,
    condition: variantData.condition || 'New',
  };
}

async function fetchMerchantPage(page: DiscoveredPage) {
  if (!(await canFetchStorePage(page.store, page.url))) {
    return [] as ParsedOffer[];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);

  try {
    const response = await fetch(page.url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) return [];

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return [];

    const html = (await response.text()).slice(0, 2_000_000);
    const finalUrl = response.url || page.url;

    const query = page.query;

    const structured = parseJsonLdProducts(
      html,
      finalUrl,
      page.store,
      query,
    );
    const listing = parseListingProducts(
      html,
      finalUrl,
      page.store,
      query,
    );

    const fallback = parseDetailFallback(
      html,
      finalUrl,
      page.store,
      query,
    );

    return [...structured, ...listing, ...fallback];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function ensureStoreSource(store: StoreSeed) {
  const merchant = await prisma.merchant.upsert({
    where: { slug: store.slug },
    create: {
      slug: store.slug,
      name: store.name,
      domain: store.domain,
      active: true,
    },
    update: {
      name: store.name,
      domain: store.domain,
      active: true,
    },
  });

  const feed = await prisma.feedSource.upsert({
    where: { slug: `adapter-${store.slug}` },
    create: {
      merchantId: merchant.id,
      slug: `adapter-${store.slug}`,
      name: `${store.name} CENIQ adapter`,
      url: store.origin,
      format: 'adapter',
      mapping: {},
    },
    update: {
      merchantId: merchant.id,
      name: `${store.name} CENIQ adapter`,
      url: store.origin,
      format: 'adapter',
      active: true,
    },
  });

  return { merchant, feed };
}

function outlierClean(items: ParsedOffer[]) {
  const grouped = new Map<string, ParsedOffer[]>();

  for (const item of items) {
    const family = familyKeyFor(item.title, item.brand);
    const vKey = variantKey(
      item.variantData,
      item.gtin,
      item.mpn,
      item.sku,
    );
    const key = `${family}|${vKey}`;
    grouped.set(key, [...(grouped.get(key) || []), item]);
  }

  const output: ParsedOffer[] = [];

  for (const group of grouped.values()) {
    const prices = group.map((item) => item.price).sort((a, b) => a - b);

    if (prices.length < 2) {
      output.push(...group);
      continue;
    }

    const reference =
      prices.length === 2
        ? prices[1]
        : prices[Math.floor(prices.length / 2)];

    for (const item of group) {
      if (reference >= 100 && item.price < reference * 0.38) continue;
      output.push(item);
    }
  }

  return output;
}


function dedupeParsedOffers(items: ParsedOffer[]) {
  const best = new Map<string, ParsedOffer>();

  for (const item of items) {
    const family = familyKeyFor(item.title, item.brand);
    const vKey = variantKey(
      item.variantData,
      item.gtin,
      item.mpn,
      item.sku,
    );
    const key = `${item.store.slug}|${family}|${vKey}`;
    const existing = best.get(key);

    if (!existing || item.price < existing.price) {
      best.set(key, item);
    }
  }

  return Array.from(best.values());
}

async function persistAdapterOffer(item: ParsedOffer) {
  if (
    !item.title ||
    !item.url ||
    !item.price ||
    item.price <= 0 ||
    item.condition !== 'New'
  ) {
    return null;
  }

  if (
    item.availability &&
    OUT_OF_STOCK.test(item.availability)
  ) {
    return null;
  }

  const brand = item.brand || inferBrand(item.title);
  const familyTitle = familyTitleFor(item.title, brand);
  const canonicalKey = familyKeyFor(item.title, brand);

  if (!canonicalKey) return null;

  const { merchant, feed } = await ensureStoreSource(item.store);

  const existingByGtin = item.gtin
    ? await prisma.catalogVariant.findFirst({
        where: { gtin: item.gtin },
        include: { family: true },
      })
    : null;

  const family =
    existingByGtin?.family ||
    (await prisma.catalogFamily.upsert({
      where: { canonicalKey },
      create: {
        canonicalKey,
        title: familyTitle,
        normalizedTitle: canonicalKey,
        brand,
        model: item.model,
        category: item.category,
        image: item.image,
      },
      update: {
        title: familyTitle,
        normalizedTitle: canonicalKey,
        brand: brand || undefined,
        model: item.model || undefined,
        category: item.category || undefined,
        image: item.image || undefined,
        active: true,
      },
    }));

  const vKey =
    existingByGtin?.variantKey ||
    variantKey(item.variantData, item.gtin, item.mpn, item.sku);

  const variant = await prisma.catalogVariant.upsert({
    where: {
      familyId_variantKey: {
        familyId: family.id,
        variantKey: vKey,
      },
    },
    create: {
      familyId: family.id,
      variantKey: vKey,
      gtin: item.gtin,
      mpn: item.mpn,
      color: item.variantData.color,
      storage: item.variantData.storage,
      ram: item.variantData.ram,
      connectivity: item.variantData.connectivity,
      size: item.variantData.size,
      condition: item.condition,
      attributes: JSON.parse(JSON.stringify(item.variantData)),
      image: item.image,
    },
    update: {
      gtin: item.gtin || undefined,
      mpn: item.mpn || undefined,
      color: item.variantData.color || undefined,
      storage: item.variantData.storage || undefined,
      ram: item.variantData.ram || undefined,
      connectivity: item.variantData.connectivity || undefined,
      size: item.variantData.size || undefined,
      condition: item.condition,
      attributes: JSON.parse(JSON.stringify(item.variantData)),
      image: item.image || undefined,
      active: true,
    },
  });

  const offerKey = hash(
    `${feed.id}|${merchant.id}|${family.id}|${vKey}`,
  );

  const old = await prisma.catalogOffer.findUnique({
    where: { offerKey },
    select: {
      id: true,
      price: true,
      availability: true,
    },
  });

  const offer = await prisma.catalogOffer.upsert({
    where: { offerKey },
    create: {
      offerKey,
      sourceId: feed.id,
      merchantId: merchant.id,
      variantId: variant.id,
      externalId: item.gtin || item.mpn || item.sku || item.url,
      title: item.title,
      url: item.url,
      image: item.image,
      price: item.price,
      oldPrice: item.oldPrice,
      currency: item.currency || 'EUR',
      availability: item.availability,
      condition: item.condition,
      active: true,
      lastSeenAt: new Date(),
    },
    update: {
      variantId: variant.id,
      externalId: item.gtin || item.mpn || item.sku || item.url,
      title: item.title,
      url: item.url,
      image: item.image || undefined,
      price: item.price,
      oldPrice: item.oldPrice,
      currency: item.currency || 'EUR',
      availability: item.availability,
      condition: item.condition,
      active: true,
      lastSeenAt: new Date(),
    },
  });

  if (
    !old ||
    Math.abs(old.price - item.price) > 0.001 ||
    old.availability !== item.availability
  ) {
    await prisma.catalogPriceSnapshot.create({
      data: {
        offerId: offer.id,
        price: item.price,
        availability: item.availability,
      },
    });
  }

  return family.id;
}

async function discoveryRecentlyAttempted(query: string) {
  const key = `v34-adapter:${normalize(query)}`;

  const row = await prisma.searchCache.findUnique({
    where: { key },
  });

  if (row && row.expiresAt > new Date()) return true;
  return false;
}

async function markDiscoveryAttempt(
  query: string,
  summary: { offers?: number },
) {
  const key = `v34-adapter:${normalize(query)}`;
  const ttlMs =
    (summary.offers || 0) > 0
      ? DISCOVERY_SUCCESS_CACHE_HOURS * 60 * 60 * 1000
      : DISCOVERY_EMPTY_CACHE_MINUTES * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  await prisma.searchCache.upsert({
    where: { key },
    create: {
      key,
      query,
      results: JSON.parse(JSON.stringify(summary)),
      expiresAt,
    },
    update: {
      query,
      results: JSON.parse(JSON.stringify(summary)),
      expiresAt,
    },
  });
}

export async function enrichCatalogFromApprovedStores(query: string) {
  if (await discoveryRecentlyAttempted(query)) {
    return {
      skipped: true,
      reason: 'cooldown',
      pages: 0,
      offers: 0,
      families: 0,
    };
  }

  const discovered = await discoverApprovedPages(query);

  const settled = await Promise.allSettled(
    discovered.slice(0, 8).map((page) => fetchMerchantPage(page)),
  );

  const discoveryOffers = discovered
    .map(discoveredPageOffer)
    .filter(Boolean) as ParsedOffer[];

  const parsed = dedupeParsedOffers(
    outlierClean([
      ...discoveryOffers,
      ...settled.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      ),
    ]),
  )
    .filter((item) => titleMatchesQuery(item.title, query))
    .sort((a, b) => relevance(b.title, query) - relevance(a.title, query));

  const touchedFamilies = new Set<string>();
  let savedOffers = 0;

  for (const item of parsed.slice(0, 30)) {
    const familyId = await persistAdapterOffer(item);
    if (familyId) {
      touchedFamilies.add(familyId);
      savedOffers += 1;
    }
  }

  for (const familyId of touchedFamilies) {
    await projectFamilyToLegacy(familyId);
  }

  const summary = {
    skipped: false,
    pages: discovered.length,
    parsed: parsed.length,
    offers: savedOffers,
    families: touchedFamilies.size,
    stores: Array.from(new Set(parsed.map((item) => item.store.slug))).length,
  };

  await markDiscoveryAttempt(query, summary);

  return summary;
}
