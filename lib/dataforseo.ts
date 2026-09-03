import type { OfferView, ProductResult } from './types';

const API_BASE = 'https://api.dataforseo.com/v3';

type Json = Record<string, any>;

type PriceObject = {
  current?: number | null;
  regular?: number | null;
  max_value?: number | null;
  currency?: string | null;
  displayed_price?: string | null;
};

type RawItem = {
  type?: string;
  domain?: string;
  source?: string;
  marketplace?: string;
  marketplace_url?: string | null;
  title?: string;
  description?: string;
  snippet?: string;
  url?: string | null;
  shopping_url?: string | null;
  seller?: string;
  seller_name?: string;
  price?: number | PriceObject | null;
  base_price?: number | null;
  tax?: number | null;
  shipping_price?: number | null;
  total_price?: number | null;
  old_price?: number | null;
  currency?: string | null;
  product_id?: string | null;
  data_docid?: string | null;
  gid?: string | number | null;
  image_url?: string | null;
  product_images?: string[] | null;
  images?: Array<{ image_url?: string | null }> | null;
  product_identifiers?: {
    product_id?: string | null;
    data_docid?: string | null;
    gid?: string | number | null;
  } | null;
  reviews_count?: number | null;
  is_best_match?: boolean | null;
  product_rating?: { value?: number | string; votes_count?: number; rating_max?: number } | null;
  rating?: { value?: number | string; votes_count?: number; rating_max?: number } | null;
  seller_rating?: { value?: number | string; votes_count?: number; rating_max?: number } | null;
  delivery_info?: {
    delivery_message?: string | null;
    delivery_price?: { current?: number | null; currency?: string | null } | null;
  } | null;
  stores_count_info?: { count?: string | number | null } | null;
  items?: RawItem[];
};

function authHeader() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error('DataForSEO credentials are not configured.');
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(json?.status_message || `DataForSEO request failed (${response.status}).`);
  }

  if (typeof json?.status_code === 'number' && json.status_code >= 40000) {
    throw new Error(json?.status_message || `DataForSEO request failed (${json.status_code}).`);
  }

  return json as Json;
}

function locationTask() {
  return {
    location_name: process.env.DATAFORSEO_LOCATION_NAME || 'Latvia',
    language_code: process.env.DATAFORSEO_LANGUAGE_CODE || 'en',
  };
}

/**
 * Fast, user-facing search.
 *
 * DataForSEO Merchant Products is asynchronous, which is a bad fit for a
 * search box because the user can sit on a spinner for a long time. The SERP
 * Live endpoint returns immediately and can contain Shopping / Popular
 * Products / commercial product blocks with price data.
 */
export async function searchProductsFast(keyword: string, useShoppingMarkup = false) {
  const depth = Math.min(50, Math.max(10, Number(process.env.DATAFORSEO_DEPTH || 20)));
  const task: Record<string, unknown> = {
    ...locationTask(),
    keyword,
    device: 'desktop',
    os: 'windows',
    depth,
  };

  if (useShoppingMarkup) task.search_param = '&udm=28';

  return request('/serp/google/organic/live/advanced', {
    method: 'POST',
    body: JSON.stringify([task]),
  });
}

/** Seller enrichment is still handled by Merchant API on product pages. */
export async function createSellersTask(ids: { productId?: string; gid?: string; dataDocId?: string }) {
  const identity = ids.productId
    ? { product_id: ids.productId }
    : ids.gid
      ? { gid: ids.gid }
      : ids.dataDocId
        ? { data_docid: ids.dataDocId }
        : null;

  if (!identity) throw new Error('Product has no DataForSEO identity for seller lookup.');

  const json = await request('/merchant/google/sellers/task_post', {
    method: 'POST',
    body: JSON.stringify([{ ...locationTask(), priority: 2, ...identity, depth: 10 }]),
  });

  const task = json?.tasks?.[0];
  if (!task?.id) throw new Error(task?.status_message || 'DataForSEO did not create a sellers task.');
  return { taskId: String(task.id), statusCode: task.status_code, statusMessage: task.status_message };
}

export async function getSellersTask(taskId: string) {
  return request(`/merchant/google/sellers/task_get/advanced/${encodeURIComponent(taskId)}`);
}

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9āčēģīķļņōŗšūž]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferBrand(title: string) {
  const token = title.trim().split(/\s+/)[0] || '';
  return token.length > 1 ? token.replace(/[,:;]+$/, '') : undefined;
}

function numberRating(value: unknown, max: unknown) {
  const v = Number(value);
  const m = Number(max || 5);
  if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0) return undefined;
  return Math.max(0, Math.min(5, (v / m) * 5));
}

function offerScore(
  total: number,
  minTotal: number,
  maxTotal: number,
  rating?: number,
  deliveryMessage?: string,
  index = 0,
) {
  const priceComponent = maxTotal === minTotal ? 42 : ((maxTotal - total) / (maxTotal - minTotal)) * 42;
  const reputationComponent = rating ? (rating / 5) * 22 : 10;
  const deliveryComponent = /free|bezmaksas/i.test(deliveryMessage || '') ? 14 : deliveryMessage ? 9 : 6;
  const relevanceComponent = Math.max(2, 12 - index * 0.5);
  return Math.round(
    Math.max(45, Math.min(99, 20 + priceComponent + reputationComponent + deliveryComponent + relevanceComponent)),
  );
}

function directPrice(item: RawItem) {
  if (typeof item.price === 'number') return item.price;
  if (item.price && typeof item.price === 'object' && typeof item.price.current === 'number') return item.price.current;
  if (typeof item.base_price === 'number') return item.base_price;
  if (typeof item.total_price === 'number') return item.total_price;
  return 0;
}

function directCurrency(item: RawItem) {
  if (item.price && typeof item.price === 'object' && item.price.currency) return item.price.currency;
  return item.currency || item.delivery_info?.delivery_price?.currency || 'EUR';
}

function pickImage(item: RawItem) {
  return item.product_images?.[0] || item.image_url || item.images?.[0]?.image_url || undefined;
}

function identifiers(item: RawItem) {
  return {
    productId: item.product_id || item.product_identifiers?.product_id || undefined,
    gid:
      item.gid != null
        ? String(item.gid)
        : item.product_identifiers?.gid != null
          ? String(item.product_identifiers.gid)
          : undefined,
    dataDocId: item.data_docid || item.product_identifiers?.data_docid || undefined,
  };
}

function itemIdentity(item: RawItem) {
  const ids = identifiers(item);
  if (ids.productId) return `pid:${ids.productId}`;
  if (ids.gid) return `gid:${ids.gid}`;
  if (ids.dataDocId) return `doc:${ids.dataDocId}`;
  return `title:${normalizeTitle(item.title || 'product')}`;
}

function isProductLike(item: RawItem) {
  if (!item.title || directPrice(item) <= 0) return false;
  const type = String(item.type || '').toLowerCase();

  if (
    type.includes('shopping') ||
    type.includes('popular_products') ||
    type.includes('commercial_units') ||
    type.includes('product')
  ) {
    return true;
  }

  // New Google Shopping markup can change item type names. Price + a merchant
  // signal is enough for our first-pass product listing.
  return Boolean(item.seller || item.seller_name || item.source || item.domain || item.marketplace || pickImage(item));
}

function collectProductItems(value: unknown, output: RawItem[] = []): RawItem[] {
  if (Array.isArray(value)) {
    for (const child of value) collectProductItems(child, output);
    return output;
  }

  if (!value || typeof value !== 'object') return output;

  const item = value as RawItem;
  if (isProductLike(item)) output.push(item);

  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child && (Array.isArray(child) || typeof child === 'object')) {
      collectProductItems(child, output);
    }
  }

  return output;
}

function merchantName(item: RawItem) {
  return (
    item.seller_name ||
    item.seller ||
    item.source ||
    item.domain ||
    item.marketplace ||
    item.description?.split('\n')[0] ||
    'Google Shopping'
  );
}

function toOffer(item: RawItem): Omit<OfferView, 'dealScore' | 'isCheapest' | 'isBestOverall'> {
  const price = directPrice(item);
  const shippingRaw = item.delivery_info?.delivery_price?.current ?? item.shipping_price;
  const shipping = typeof shippingRaw === 'number' && shippingRaw > 0 ? shippingRaw : 0;
  const explicitTotal = typeof item.total_price === 'number' && item.total_price > 0 ? item.total_price : undefined;

  return {
    merchant: merchantName(item),
    merchantDomain: item.domain || undefined,
    price,
    shipping,
    totalPrice: explicitTotal ?? price + shipping,
    currency: directCurrency(item),
    sellerRating: numberRating(
      item.seller_rating?.value ?? item.rating?.value ?? item.product_rating?.value,
      item.seller_rating?.rating_max ?? item.rating?.rating_max ?? item.product_rating?.rating_max,
    ),
    sellerVotes:
      item.seller_rating?.votes_count ?? item.rating?.votes_count ?? item.product_rating?.votes_count ?? item.reviews_count ?? undefined,
    deliveryMessage: item.delivery_info?.delivery_message || undefined,
    url: item.url || item.shopping_url || item.marketplace_url || undefined,
  };
}

export function mapFastProductSearch(json: Json): ProductResult[] {
  const task = json?.tasks?.[0];
  if (!task) return [];

  if (typeof task.status_code === 'number' && task.status_code >= 40000) {
    throw new Error(task.status_message || 'DataForSEO Live search failed.');
  }

  const rawItems = collectProductItems(task.result || []);
  const groups = new Map<string, RawItem[]>();

  for (const item of rawItems) {
    const key = itemIdentity(item);
    groups.set(key, [...(groups.get(key) || []), item]);
  }

  const products: ProductResult[] = Array.from(groups.entries()).map(([key, items]) => {
    const sortedItems = [...items].sort((a, b) => directPrice(a) - directPrice(b));
    const first = sortedItems[0];
    const ids = identifiers(first);
    const rawOffers = sortedItems.map(toOffer);
    const totals = rawOffers.map((offer) => offer.totalPrice);
    const min = Math.min(...totals);
    const max = Math.max(...totals);

    const offers: OfferView[] = rawOffers.map((offer, index) => ({
      ...offer,
      dealScore: offerScore(offer.totalPrice, min, max, offer.sellerRating, offer.deliveryMessage, index),
      isCheapest: offer.totalPrice === min,
      isBestOverall: false,
    }));

    let bestIndex = 0;
    offers.forEach((offer, index) => {
      if (offer.dealScore > offers[bestIndex].dealScore) bestIndex = index;
    });
    if (offers[bestIndex]) offers[bestIndex].isBestOverall = true;

    return {
      id: key,
      externalId: key,
      gid: ids.gid,
      dataDocId: ids.dataDocId,
      title: first.title || 'Produkts',
      normalizedTitle: normalizeTitle(first.title || 'Produkts'),
      brand: inferBrand(first.title || ''),
      category: 'Elektronika',
      description: first.description || first.snippet || undefined,
      image: pickImage(first),
      bestPrice: min,
      currency: offers[0]?.currency || directCurrency(first),
      dealScore: offers[bestIndex]?.dealScore || 50,
      offers: offers.sort((a, b) => a.totalPrice - b.totalPrice),
      storesCount: offers.length,
    };
  });

  return products
    .filter((product) => Number.isFinite(product.bestPrice) && product.bestPrice > 0)
    .sort((a, b) => b.dealScore - a.dealScore || a.bestPrice - b.bestPrice)
    .slice(0, 24);
}

function flattenMerchant(items: RawItem[] = []): RawItem[] {
  const output: RawItem[] = [];
  for (const item of items) {
    if (item && typeof item === 'object') {
      if (item.title && directPrice(item) > 0) output.push(item);
      if (Array.isArray(item.items)) output.push(...flattenMerchant(item.items));
    }
  }
  return output;
}

export function mapSellerOffers(json: Json): OfferView[] {
  const task = json?.tasks?.[0];
  if (!task) return [];

  if (task.status_code >= 40000 && task.status_code !== 40601 && task.status_code !== 40602) {
    throw new Error(task.status_message || 'DataForSEO seller task failed.');
  }

  const raw: RawItem[] = (task.result || []).flatMap((result: Json) => flattenMerchant(result?.items || []));
  const offers = raw.filter((item) => directPrice(item) > 0).map(toOffer);
  if (!offers.length) return [];

  const totals = offers.map((offer) => offer.totalPrice);
  const min = Math.min(...totals);
  const max = Math.max(...totals);

  const scored: OfferView[] = offers.map((offer, index) => ({
    ...offer,
    dealScore: offerScore(offer.totalPrice, min, max, offer.sellerRating, offer.deliveryMessage, index),
    isCheapest: offer.totalPrice === min,
    isBestOverall: false,
  }));

  let best = 0;
  scored.forEach((offer, index) => {
    if (offer.dealScore > scored[best].dealScore) best = index;
  });
  scored[best].isBestOverall = true;

  return scored.sort((a, b) => a.totalPrice - b.totalPrice);
}

export function taskPending(json: Json) {
  const task = json?.tasks?.[0];
  if (!task) return true;
  return task.status_code === 40601 || task.status_code === 40602 || !Array.isArray(task.result);
}
