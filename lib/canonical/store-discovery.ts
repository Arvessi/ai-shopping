import { LATVIA_ELECTRONICS_STORES } from '@/lib/store-registry';
import { extractAttributes, normalizeText, type IdentifierCandidate, type NormalizedOfferCandidate } from './domain.ts';
import { canonicalizeMerchantProductTitle } from './title-normalization.ts';

const API_BASE = 'https://api.dataforseo.com/v3';
const PAGE_TIMEOUT_MS = 3000;
const MAX_PAGE_FETCHES = 24;
const MAX_PAGES_PER_STORE = 2;

type Json = Record<string, any>;

type FoundPage = {
  url: string;
  title: string;
  snippet: string;
  domain: string;
  merchant: string;
  price?: number;
  currency?: string;
  image?: string;
};

function auth() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error('DataForSEO credentials are not configured.');
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;
}

function host(value: string) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function approvedStore(domain: string) {
  return LATVIA_ELECTRONICS_STORES.find((store) => {
    const wanted = store.domain.toLowerCase().replace(/^www\./, '');
    return domain === wanted || domain.endsWith(`.${wanted}`);
  });
}

function number(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value == null) return undefined;
  const raw = String(value).replace(/\u00a0/g, ' ').replace(/\s/g, '').replace(/[^\d,.-]/g, '');
  if (!raw) return undefined;
  const normalized = raw.includes(',') && raw.includes('.')
    ? raw.lastIndexOf(',') > raw.lastIndexOf('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '')
    : raw.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function itemPrice(item: Json) {
  if (typeof item.price === 'number') return number(item.price);
  return number(item.price?.current) || number(item.price?.value) || number(item.current_price) || number(item.total_price) || number(item.base_price);
}

function queryTokens(query: string) {
  return normalizeText(query)
    .split(' ')
    .filter((token) => token.length > 1)
    .filter((token) => !['cena', 'price', 'latvija', 'latvia', 'telefons', 'phone', 'laptop', 'notebook', 'tv', 'monitor'].includes(token))
    .filter((token) => !/^(?:64|128|256|512|1024|2048)gb$/.test(token))
    .filter((token) => !/^\d+(?:\.\d+)?tb$/.test(token))
    .filter((token) => !/^\d{1,3}$/.test(token));
}

function matchesQuery(text: string, query: string) {
  const haystack = normalizeText(text);
  const tokens = queryTokens(query);
  if (!tokens.length) return true;
  return tokens.every((token) => haystack.includes(token));
}

function walk(value: unknown, query: string, output: FoundPage[]) {
  if (Array.isArray(value)) {
    value.forEach((child) => walk(child, query, output));
    return;
  }
  if (!value || typeof value !== 'object') return;

  const item = value as Json;
  const url = String(item.url || item.shopping_url || '');
  const title = String(item.title || '').trim();
  const snippet = String(item.description || item.snippet || '').trim();
  const domain = host(url);
  const store = approvedStore(domain);

  if (url && title && store && matchesQuery(`${title} ${snippet}`, query)) {
    output.push({
      url,
      title,
      snippet,
      domain: store.domain,
      merchant: store.name,
      price: itemPrice(item),
      currency: String(item.price?.currency || item.currency || 'EUR'),
      image: String(item.image_url || item.product_images?.[0] || item.images?.[0]?.image_url || '') || undefined,
    });
  }

  for (const child of Object.values(item)) {
    if (child && typeof child === 'object') walk(child, query, output);
  }
}

async function liveStoreSearch(keyword: string) {
  const response = await fetch(`${API_BASE}/serp/google/organic/live/advanced`, {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify([{
      location_name: process.env.DATAFORSEO_LOCATION_NAME || 'Latvia',
      language_code: process.env.DATAFORSEO_LANGUAGE_CODE || 'en',
      keyword,
      device: 'desktop',
      os: 'windows',
      depth: 100,
    }]),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });

  const json = (await response.json().catch(() => ({}))) as Json;
  if (!response.ok || Number(json.status_code || 0) >= 40000) {
    throw new Error(json.status_message || `Store discovery failed (${response.status}).`);
  }
  return json;
}

async function discoverPages(query: string) {
  const stores = LATVIA_ELECTRONICS_STORES.filter((store) => store.enabled !== false);
  const groups: typeof stores[] = [];
  for (let i = 0; i < stores.length; i += 13) groups.push(stores.slice(i, i + 13));

  const keywords = groups.slice(0, 2).map(
    (group) => `${query} (${group.map((store) => `site:${store.domain}`).join(' OR ')})`,
  );

  // Live SERP only accepts one task per request. Run the two Latvian-store groups
  // as separate calls and merge them; the old multi-task payload could fail entirely.
  const settled = await Promise.allSettled(keywords.map((keyword) => liveStoreSearch(keyword)));
  const found: FoundPage[] = [];
  let successfulCalls = 0;

  for (const result of settled) {
    if (result.status === 'rejected') continue;
    successfulCalls += 1;
    walk(result.value.tasks || [], query, found);
  }

  if (!successfulCalls && settled.length) {
    const errors = settled
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
    throw new Error(`Store discovery failed: ${errors.join(' | ')}`);
  }

  const unique = new Map<string, FoundPage>();
  for (const page of found) {
    const existing = unique.get(page.url);
    if (!existing || (!existing.price && page.price) || (!existing.image && page.image)) unique.set(page.url, page);
  }

  const perStore = new Map<string, FoundPage[]>();
  for (const page of unique.values()) {
    const list = perStore.get(page.domain) || [];
    if (list.length < MAX_PAGES_PER_STORE) list.push(page);
    perStore.set(page.domain, list);
  }

  const balanced: FoundPage[] = [];
  for (let round = 0; round < MAX_PAGES_PER_STORE; round += 1) {
    for (const pages of perStore.values()) {
      if (pages[round]) balanced.push(pages[round]);
      if (balanced.length >= MAX_PAGE_FETCHES) return balanced;
    }
  }
  return balanced;
}

function meta(html: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["']`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern)?.[1];
      if (match) return match.replace(/&amp;/g, '&').trim();
    }
  }
  return undefined;
}

function jsonLdProducts(html: string) {
  const products: Json[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    try {
      const parsed = JSON.parse(match[1]);
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const value = queue.shift();
        if (!value || typeof value !== 'object') continue;
        if (String(value['@type'] || '').toLowerCase() === 'product') products.push(value);
        if (Array.isArray(value['@graph'])) queue.push(...value['@graph']);
      }
    } catch {
      // Ignore malformed merchant JSON-LD.
    }
  }
  return products;
}

async function enrichPage(page: FoundPage, query: string): Promise<FoundPage> {
  if (page.price && page.price > 0 && page.image) return page;

  try {
    const response = await fetch(page.url, {
      headers: { 'User-Agent': 'CENIQBot/1.0 (+https://ceniq.lv)', Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!response.ok || !(response.headers.get('content-type') || '').includes('text/html')) return page;
    const html = (await response.text()).slice(0, 1_500_000);

    const fallbackImage = meta(html, ['og:image', 'twitter:image', 'image']);
    for (const product of jsonLdProducts(html)) {
      const title = String(product.name || page.title);
      if (!matchesQuery(`${title} ${page.snippet}`, query)) continue;
      const productImage = String(Array.isArray(product.image) ? product.image[0] : product.image || fallbackImage || page.image || '') || undefined;
      const offers = Array.isArray(product.offers) ? product.offers : product.offers ? [product.offers] : [];
      for (const offer of offers) {
        const foundPrice = number(offer?.price || offer?.lowPrice);
        if (!foundPrice && !page.price) continue;
        return {
          ...page,
          title,
          price: foundPrice || page.price,
          currency: String(offer?.priceCurrency || page.currency || 'EUR'),
          image: productImage,
        };
      }
      if (page.price) return { ...page, title, image: productImage };
    }

    const foundPrice = number(meta(html, ['product:price:amount', 'og:price:amount', 'price', 'priceAmount']));
    return {
      ...page,
      price: foundPrice || page.price,
      currency: meta(html, ['product:price:currency', 'og:price:currency', 'priceCurrency']) || page.currency || 'EUR',
      image: fallbackImage || page.image,
    };
  } catch {
    return page;
  }
}

function meaningfulVariantAttributes(attributes: Record<string, string | undefined>) {
  return Object.entries(attributes).some(([key, value]) => key !== 'condition' && Boolean(value));
}

function fallbackIdentifier(title: string, attributes: Record<string, string | undefined>): IdentifierCandidate | undefined {
  if (meaningfulVariantAttributes(attributes)) return undefined;
  const value = normalizeText(title);
  if (value.length < 5 || value.split(' ').length < 2) return undefined;
  return { type: 'MODEL_ALIAS', value, source: 'ceniq-store-title', confidence: 0.75 };
}

export async function discoverLatvianStoreCandidates(query: string): Promise<NormalizedOfferCandidate[]> {
  const pages = await discoverPages(query);
  const enriched = await Promise.all(pages.map((page) => enrichPage(page, query)));

  const candidates: NormalizedOfferCandidate[] = [];
  const seen = new Set<string>();
  for (const page of enriched) {
    if (!page.price || page.price <= 0 || !matchesQuery(`${page.title} ${page.snippet}`, query)) continue;
    const key = `${page.domain}|${page.url}|${page.price}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const originalTitle = page.title;
    const identity = canonicalizeMerchantProductTitle(originalTitle);
    const attributes = extractAttributes(`${originalTitle} ${page.snippet}`);
    const identifier = fallbackIdentifier(identity.title, attributes);

    candidates.push({
      source: 'ceniq-lv-store-discovery',
      sourceKey: page.url,
      merchant: { name: page.merchant, domain: page.domain },
      title: identity.title,
      brand: identity.brand,
      description: page.snippet || originalTitle,
      url: page.url,
      image: page.image ? { url: page.image, source: 'store-discovery', provenance: 'variant', confidence: 0.85 } : undefined,
      identifiers: identifier ? [identifier] : undefined,
      attributes,
      price: page.price,
      currency: page.currency || 'EUR',
      evidence: {
        displayedPrice: `${page.price} ${page.currency || 'EUR'}`,
        sellerText: page.merchant,
        surroundingText: `${originalTitle} ${page.snippet}`,
        explicitOneTime: true,
      },
    });
  }
  return candidates;
}
