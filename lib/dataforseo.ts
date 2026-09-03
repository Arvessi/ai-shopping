import type { OfferView, ProductResult } from './types';

const BASE = 'https://api.dataforseo.com/v3/merchant/google';

type Json = Record<string, any>;

type RawItem = {
  type?: string;
  domain?: string;
  title?: string;
  description?: string;
  url?: string | null;
  shopping_url?: string | null;
  seller?: string;
  seller_name?: string;
  price?: number | null;
  base_price?: number | null;
  tax?: number | null;
  shipping_price?: number | null;
  total_price?: number | null;
  old_price?: number | null;
  currency?: string | null;
  product_id?: string | null;
  data_docid?: string | null;
  gid?: string | null;
  image_url?: string | null;
  product_images?: string[] | null;
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
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  const json = await response.json();
  if (!response.ok && json?.status_code !== 40401) {
    throw new Error(json?.status_message || `DataForSEO request failed (${response.status}).`);
  }
  return json as Json;
}

function commonTask() {
  return {
    location_name: process.env.DATAFORSEO_LOCATION_NAME || 'Latvia',
    language_code: process.env.DATAFORSEO_LANGUAGE_CODE || 'en',
    priority: 1,
  };
}

export async function createProductSearchTask(keyword: string) {
  const depth = Math.min(50, Math.max(10, Number(process.env.DATAFORSEO_DEPTH || 20)));
  const json = await request('/products/task_post', {
    method: 'POST',
    body: JSON.stringify([{ ...commonTask(), keyword, depth }]),
  });
  const task = json?.tasks?.[0];
  if (!task?.id) throw new Error(task?.status_message || 'DataForSEO did not create a search task.');
  return { taskId: String(task.id), statusCode: task.status_code, statusMessage: task.status_message };
}

export async function getProductSearchTask(taskId: string) {
  return request(`/products/task_get/advanced/${encodeURIComponent(taskId)}`);
}

export async function createSellersTask(ids: { productId?: string; gid?: string; dataDocId?: string }) {
  const identity = ids.productId ? { product_id: ids.productId } : ids.gid ? { gid: ids.gid } : ids.dataDocId ? { data_docid: ids.dataDocId } : null;
  if (!identity) throw new Error('Product has no DataForSEO identity for seller lookup.');
  const json = await request('/sellers/task_post', {
    method: 'POST',
    body: JSON.stringify([{ ...commonTask(), ...identity, depth: 10 }]),
  });
  const task = json?.tasks?.[0];
  if (!task?.id) throw new Error(task?.status_message || 'DataForSEO did not create a sellers task.');
  return { taskId: String(task.id), statusCode: task.status_code, statusMessage: task.status_message };
}

export async function getSellersTask(taskId: string) {
  return request(`/sellers/task_get/advanced/${encodeURIComponent(taskId)}`);
}

function flatten(items: RawItem[] = []): RawItem[] {
  const output: RawItem[] = [];
  for (const item of items) {
    if (item && typeof item === 'object') {
      const hasPrice = typeof item.price === 'number' || typeof item.base_price === 'number' || typeof item.total_price === 'number';
      if (hasPrice && item.title) output.push(item);
      if (Array.isArray(item.items)) output.push(...flatten(item.items));
    }
  }
  return output;
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

function offerScore(total: number, minTotal: number, maxTotal: number, rating?: number, deliveryMessage?: string, index = 0) {
  const priceComponent = maxTotal === minTotal ? 42 : ((maxTotal - total) / (maxTotal - minTotal)) * 42;
  const reputationComponent = rating ? (rating / 5) * 22 : 10;
  const deliveryComponent = /free|bezmaksas/i.test(deliveryMessage || '') ? 14 : deliveryMessage ? 9 : 6;
  const relevanceComponent = Math.max(2, 12 - index * 0.5);
  return Math.round(Math.max(45, Math.min(99, 20 + priceComponent + reputationComponent + deliveryComponent + relevanceComponent)));
}

function pickImage(item: RawItem) {
  return item.product_images?.[0] || item.image_url || undefined;
}

function itemIdentity(item: RawItem) {
  if (item.product_id) return `pid:${item.product_id}`;
  if (item.gid) return `gid:${item.gid}`;
  if (item.data_docid) return `doc:${item.data_docid}`;
  return `title:${normalizeTitle(item.title || 'product')}`;
}

function toOffer(item: RawItem): Omit<OfferView, 'dealScore' | 'isCheapest' | 'isBestOverall'> {
  const price = Number(item.price ?? item.base_price ?? item.total_price ?? 0);
  const shippingRaw = item.delivery_info?.delivery_price?.current ?? item.shipping_price;
  const shipping = typeof shippingRaw === 'number' && shippingRaw > 0 ? shippingRaw : 0;
  const explicitTotal = typeof item.total_price === 'number' && item.total_price > 0 ? item.total_price : undefined;
  return {
    merchant: item.seller_name || item.seller || item.domain || 'Veikals',
    merchantDomain: item.domain || undefined,
    price,
    shipping,
    totalPrice: explicitTotal ?? (price + shipping),
    currency: item.currency || 'EUR',
    sellerRating: numberRating(item.seller_rating?.value ?? item.rating?.value ?? item.product_rating?.value, item.seller_rating?.rating_max ?? item.rating?.rating_max ?? item.product_rating?.rating_max),
    sellerVotes: item.seller_rating?.votes_count ?? item.rating?.votes_count ?? item.product_rating?.votes_count,
    deliveryMessage: item.delivery_info?.delivery_message || undefined,
    url: item.url || item.shopping_url || undefined,
  };
}

export function mapProductSearch(json: Json): ProductResult[] {
  const task = json?.tasks?.[0];
  if (!task) return [];
  if (task.status_code >= 40000 && task.status_code !== 40601 && task.status_code !== 40602) {
    throw new Error(task.status_message || 'DataForSEO task failed.');
  }
  const resultItems = (task.result || []).flatMap((r: Json) => flatten(r?.items || []));
  const groups = new Map<string, RawItem[]>();
  for (const item of resultItems) {
    if (!item.title || typeof item.price !== 'number' || item.price <= 0) continue;
    const key = itemIdentity(item);
    groups.set(key, [...(groups.get(key) || []), item]);
  }

  return Array.from(groups.entries()).map(([key, items]) => {
    const sorted = [...items].sort((a, b) => Number(a.price) - Number(b.price));
    const first = sorted[0];
    const rawOffers = sorted.map(toOffer);
    const totals = rawOffers.map((o) => o.totalPrice);
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    const scored = rawOffers.map((offer, index) => ({
      ...offer,
      dealScore: offerScore(offer.totalPrice, min, max, offer.sellerRating, offer.deliveryMessage, index),
      isCheapest: offer.totalPrice === min,
      isBestOverall: false,
    }));
    let bestIndex = 0;
    scored.forEach((offer, index) => { if (offer.dealScore > scored[bestIndex].dealScore) bestIndex = index; });
    scored[bestIndex].isBestOverall = true;
    const bestPrice = min;
    const dealScore = scored[bestIndex]?.dealScore || 50;
    const count = Number(first.stores_count_info?.count || scored.length);

    return {
      id: key,
      externalId: key,
      gid: first.gid || undefined,
      dataDocId: first.data_docid || undefined,
      title: first.title || 'Produkts',
      normalizedTitle: normalizeTitle(first.title || 'Produkts'),
      brand: inferBrand(first.title || ''),
      category: 'Elektronika',
      description: first.description || undefined,
      image: pickImage(first),
      bestPrice,
      currency: first.currency || 'EUR',
      dealScore,
      offers: scored,
      storesCount: Number.isFinite(count) ? count : scored.length,
    };
  }).sort((a, b) => b.dealScore - a.dealScore || a.bestPrice - b.bestPrice);
}

export function mapSellerOffers(json: Json): OfferView[] {
  const task = json?.tasks?.[0];
  if (!task) return [];
  if (task.status_code >= 40000 && task.status_code !== 40601 && task.status_code !== 40602) {
    throw new Error(task.status_message || 'DataForSEO seller task failed.');
  }
  const raw = (task.result || []).flatMap((r: Json) => flatten(r?.items || []));
  const offers: Array<ReturnType<typeof toOffer>> = raw.filter((i: RawItem) => Number(i.price ?? i.base_price ?? i.total_price ?? 0) > 0).map((i: RawItem) => toOffer(i));
  if (!offers.length) return [];
  const totals = offers.map((o: ReturnType<typeof toOffer>) => o.totalPrice);
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  const scored: OfferView[] = offers.map((offer: ReturnType<typeof toOffer>, index: number) => ({
    ...offer,
    dealScore: offerScore(offer.totalPrice, min, max, offer.sellerRating, offer.deliveryMessage, index),
    isCheapest: offer.totalPrice === min,
    isBestOverall: false,
  }));
  let best = 0;
  scored.forEach((offer: OfferView, index: number) => { if (offer.dealScore > scored[best].dealScore) best = index; });
  scored[best].isBestOverall = true;
  return scored.sort((a: OfferView, b: OfferView) => a.totalPrice - b.totalPrice);
}

export function taskPending(json: Json) {
  const task = json?.tasks?.[0];
  if (!task) return true;
  return task.status_code === 40601 || task.status_code === 40602 || !Array.isArray(task.result);
}
