import { LATVIA_ELECTRONICS_STORES } from '@/lib/store-registry';
import { extractAttributes, normalizeText, type NormalizedOfferCandidate } from './domain';
import { canonicalizeMerchantProductTitle } from './title-normalization';

const API_BASE = 'https://api.dataforseo.com/v3';
const PAGE_TIMEOUT_MS = 2800;
const MAX_PAGE_FETCHES = 12;

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
  return (
    number(item.price?.current) ||
    number(item.price?.value) ||
    number(item.current_price) ||
    number(item.total_price) ||
    number(item.base_price)
  );
}

function matchesQuery(text: string, query: string) {
  const haystack = normalizeText(text);
  const tokens = normalizeText(query).split(' ').filter((token) => token.length > 1);
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

  Object.values(item).forEach((child) => {
    if (child && typeof child === 'object') walk(child, query, output);
  });
}

async function discoverPages(query: string) {
  const stores = LATVIA_ELECTRONICS_STORES.filter((store) => store.enabled !== false);
  const groups: typeof stores[] = [];
  for (let i = 0; i < stores.length; i += 13) groups.push(stores.slice(i, i + 13));

  const tasks = groups.slice(0, 2).map((group) => ({
    location_name: process.env.DATAFORSEO_LOCATION_NAME || 'Latvia',
    language_code: process.env.DATAFORSEO_LANGUAGE_CODE || 'en',
    keyword: `${query} (${group.map((store) => `site:${store.domain}`).join(' OR ')})`,
    device: 'desktop',
    os: 'windows',
    depth: 50,
  }));

  const response = await fetch(`${API_BASE}/serp/google/organic/live/advanced`, {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(tasks),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });

  const json = (await response.json().catch(() => ({}))) as Json;
  if (!response.ok || Number(json.status_code || 0) >= 40000) {
    throw new Error(json.status_message || `Store discovery failed (${response.status}).`);
  }

  const found: FoundPage[] = [];
  walk(json.tasks || [], query, found);

  const unique = new Map<string, FoundPage>();
  for (const page of found) {
    const existing = unique.get(page.url);
    if (!existing || (!existing.price && page.price) || (!existing.image && page.image)) unique.set(page.url, page);
  }
  return Array.from(unique.values());
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
      // Ignore malformed JSON-LD.
    }
  }
  return products;
}

async function enrichPage(page: FoundPage, query: string): Promise<FoundPage> {
  // If search discovery already gave us both price and image, there is nothing
  // useful to add. Otherwise fetch the product page so images are available on
  // the very first result render instead of waiting for background enrichment.
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
      if (!matchesQuery(title, query)) continue;
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

      if (page.price) {
        return { ...page, title, image: productImage };
      }
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

export async function discoverLatvianStoreCandidates(query: string): Promise<NormalizedOfferCandidate[]> {
  const pages = await discoverPages(query);
  const enriched = await Promise.all(
    pages.slice(0, MAX_PAGE_FETCHES).map((page) => enrichPage(page, query)),
  );

  const candidates: NormalizedOfferCandidate[] = [];
  const seen = new Set<string>();
  for (const page of enriched) {
    if (!page.price || page.price <= 0 || !matchesQuery(`${page.title} ${page.snippet}`, query)) continue;
    const key = `${page.domain}|${page.url}|${page.price}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const originalTitle = page.title;
    const identity = canonicalizeMerchantProductTitle(originalTitle);
    candidates.push({
      source: 'ceniq-lv-store-discovery',
      sourceKey: page.url,
      merchant: { name: page.merchant, domain: page.domain },
      title: identity.title,
      brand: identity.brand,
      description: page.snippet || originalTitle,
      url: page.url,
      image: page.image ? { url: page.image, source: 'store-discovery', provenance: 'variant', confidence: 0.85 } : undefined,
      attributes: extractAttributes(`${originalTitle} ${page.snippet}`),
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
