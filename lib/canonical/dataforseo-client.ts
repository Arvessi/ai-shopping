import { extractAttributes, normalizeText, providerTaskState, type IdentifierCandidate, type NormalizedOfferCandidate } from './domain.ts';
import { canonicalizeMerchantProductTitle } from './title-normalization.ts';

const API_BASE = 'https://api.dataforseo.com/v3';
const REQUEST_TIMEOUT_MS = Math.min(20_000, Math.max(3_000, Number(process.env.DATAFORSEO_TIMEOUT_MS || 12_000)));

type Json = Record<string, any>;
type RawShoppingItem = { item: Json; keyword?: string };

function authorization() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error('DataForSEO credentials are not configured.');
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Authorization: authorization(), 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json = await response.json().catch(() => ({})) as Json;
  if (!response.ok || Number(json.status_code || 0) >= 40000) {
    throw new Error(json.status_message || `DataForSEO request failed (${response.status}).`);
  }
  return json;
}

function taskPayload(keyword: string) {
  return [{
    location_name: process.env.DATAFORSEO_LOCATION_NAME || 'Latvia',
    language_code: process.env.DATAFORSEO_LANGUAGE_CODE || 'en',
    keyword,
    priority: Number(process.env.DATAFORSEO_MERCHANT_PRIORITY || 1) === 2 ? 2 : 1,
    depth: Math.min(100, Math.max(20, Number(process.env.DATAFORSEO_DEPTH || 60))),
  }];
}

export async function createShoppingTask(keyword: string) {
  const json = await request('/merchant/google/products/task_post', { method: 'POST', body: JSON.stringify(taskPayload(keyword)) });
  const task = json.tasks?.[0];
  if (!task?.id) throw new Error(task?.status_message || 'DataForSEO did not create a shopping task.');
  return String(task.id);
}

export function shoppingTasksReadyIds(json: Json) {
  const ids = new Set<string>();
  for (const task of json.tasks || []) {
    if (!Array.isArray(task?.result)) continue;
    for (const row of task.result) if (row?.id) ids.add(String(row.id));
  }
  return ids;
}

export async function isShoppingTaskReady(taskId: string) {
  const json = await request('/merchant/google/products/tasks_ready');
  return shoppingTasksReadyIds(json).has(taskId);
}

export async function getShoppingTask(taskId: string) {
  const json = await request(`/merchant/google/products/task_get/advanced/${encodeURIComponent(taskId)}`);
  const task = json.tasks?.[0] || {};
  return { json, task, state: providerTaskState(task) };
}

export async function discoverShoppingLive(keyword: string) {
  return discoverShoppingLiveMany([keyword]);
}

async function discoverShoppingLiveOne(keyword: string) {
  const json = await request('/serp/google/organic/live/advanced', {
    method: 'POST',
    body: JSON.stringify([{
      ...taskPayload(keyword)[0],
      device: 'desktop',
      os: 'windows',
      search_param: '&udm=28',
    }]),
  });
  return { keyword, json };
}

export async function discoverShoppingLiveMany(keywords: string[]) {
  const clean = Array.from(new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean))).slice(0, 8);

  // Live SERP accepts exactly one task per HTTP request. Previously we sent many
  // tasks in one payload, so cold searches silently failed while old DB rows still
  // appeared. Run each query separately and merge the returned task arrays.
  const settled = await Promise.allSettled(clean.map((keyword) => discoverShoppingLiveOne(keyword)));
  const tasks: Json[] = [];
  const failures: Array<{ keyword: string; error: string }> = [];

  settled.forEach((result, index) => {
    const keyword = clean[index];
    if (result.status === 'rejected') {
      failures.push({ keyword, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      return;
    }

    for (const task of result.value.json.tasks || []) {
      tasks.push({ ...task, __ceniqKeyword: keyword });
    }
  });

  if (!tasks.length && failures.length) {
    throw new Error(`DataForSEO live discovery failed: ${failures.map((row) => `${row.keyword}: ${row.error}`).join(' | ')}`);
  }

  return { status_code: 20000, tasks, __ceniqKeywords: clean, __ceniqFailures: failures } as Json;
}

type ShoppingIdentity = { productId?: string; gid?: string; dataDocId?: string };

function identityPayload(identity: ShoppingIdentity) {
  if (identity.productId) return { product_id: identity.productId };
  if (identity.gid) return { gid: identity.gid };
  if (identity.dataDocId) return { data_docid: identity.dataDocId };
  throw new Error('DataForSEO product identity is missing.');
}

async function createIdentityTask(path: string, identity: ShoppingIdentity) {
  const json = await request(path, {
    method: 'POST',
    body: JSON.stringify([{ location_name: process.env.DATAFORSEO_LOCATION_NAME || 'Latvia', language_code: process.env.DATAFORSEO_LANGUAGE_CODE || 'en', priority: 1, ...identityPayload(identity) }]),
  });
  const task = json.tasks?.[0];
  if (!task?.id) throw new Error(task?.status_message || 'DataForSEO did not create the identity task.');
  return String(task.id);
}

export const createSellersTask = (identity: ShoppingIdentity) => createIdentityTask('/merchant/google/sellers/task_post', identity);
export const createProductInfoTask = (identity: ShoppingIdentity) => createIdentityTask('/merchant/google/product_info/task_post', identity);
export const getSellersTask = (taskId: string) => request(`/merchant/google/sellers/task_get/advanced/${encodeURIComponent(taskId)}`);
export const getProductInfoTask = (taskId: string) => request(`/merchant/google/product_info/task_get/advanced/${encodeURIComponent(taskId)}`);

function domain(value: unknown) {
  try {
    return new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(value || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

function price(item: Json) {
  if (typeof item.price === 'number') return item.price;
  for (const value of [item.price?.current, item.price?.value, item.current_price, item.price_from, item.total_price, item.base_price]) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return NaN;
}

function identifiers(item: Json): IdentifierCandidate[] {
  const output: IdentifierCandidate[] = [];
  for (const [type, value] of [['GTIN', item.gtin], ['EAN', item.ean], ['UPC', item.upc], ['MPN', item.mpn], ['SKU_ALIAS', item.product_id || item.gid || item.data_docid]] as const) {
    if (value != null && String(value).trim()) {
      output.push({ type, value: String(value), source: 'dataforseo', confidence: type === 'SKU_ALIAS' ? 0.7 : 0.95 });
    }
  }
  return output;
}

function walkItems(value: unknown, output: RawShoppingItem[], keyword?: string) {
  if (Array.isArray(value)) {
    value.forEach((child) => walkItems(child, output, keyword));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const item = value as Json;
  if (item.title && Number.isFinite(price(item)) && (item.seller_name || item.seller || item.domain || item.url || item.shopping_url)) {
    output.push({ item, keyword });
  }
  for (const child of Object.values(item)) {
    if (child && typeof child === 'object') walkItems(child, output, keyword);
  }
}

function meaningfulVariantAttributes(attributes: Record<string, string | undefined>) {
  return Object.entries(attributes).some(([key, value]) => key !== 'condition' && Boolean(value));
}

function fallbackModelIdentifier(title: string, attributes: Record<string, string | undefined>): IdentifierCandidate | undefined {
  if (meaningfulVariantAttributes(attributes)) return undefined;
  const normalized = normalizeText(title);
  if (normalized.length < 5 || normalized.split(' ').length < 2) return undefined;
  return { type: 'MODEL_ALIAS', value: normalized, source: 'ceniq-title', confidence: 0.72 };
}

function hasStrongIdentifier(items: IdentifierCandidate[]) {
  return items.some((identifier) => ['GTIN', 'EAN', 'UPC', 'MPN', 'MODEL_ALIAS'].includes(identifier.type));
}

export function mapShoppingCandidates(json: Json): NormalizedOfferCandidate[] {
  const raw: RawShoppingItem[] = [];
  const rememberedKeywords = Array.isArray(json.__ceniqKeywords) ? json.__ceniqKeywords.map(String) : [];
  for (const [index, task] of (json.tasks || []).entries()) {
    const keyword = String(task?.__ceniqKeyword || task?.data?.keyword || task?.result?.[0]?.keyword || rememberedKeywords[index] || '');
    walkItems(task?.result || [], raw, keyword);
  }

  const seen = new Set<string>();
  const output: NormalizedOfferCandidate[] = [];
  for (const { item, keyword } of raw) {
    const url = String(item.url || item.shopping_url || '');
    const merchantDomain = domain(item.domain || url);
    const merchantName = String(item.seller_name || item.seller || merchantDomain || 'Merchant');
    const amount = price(item);
    const originalTitle = String(item.title);
    const description = String(item.description || item.snippet || '');
    const identity = canonicalizeMerchantProductTitle(originalTitle, item.brand ? String(item.brand) : undefined);
    const sourceKey = String(item.offer_id || item.product_id || item.gid || `${url}|${originalTitle}`);
    const unique = `${merchantDomain}|${sourceKey}`;
    if (!url || !merchantDomain || seen.has(unique)) continue;
    seen.add(unique);

    const shippingRaw = Number(item.delivery_info?.delivery_price?.current ?? item.shipping_price);
    const image = [...(item.product_images || []), item.image_url, ...(item.images || []).map((entry: any) => entry?.image_url || entry)]
      .find((value) => /^https?:\/\//i.test(String(value)));

    const explicitAttributes = extractAttributes(`${originalTitle} ${description}`);
    const queryAttributes = keyword ? extractAttributes(keyword) : {};
    const attributes = {
      ...explicitAttributes,
      storage: explicitAttributes.storage || queryAttributes.storage,
      ram: explicitAttributes.ram || queryAttributes.ram,
      connectivity: explicitAttributes.connectivity || queryAttributes.connectivity,
      size: explicitAttributes.size || queryAttributes.size,
    };

    const itemIdentifiers = identifiers(item);
    const fallbackIdentifier = fallbackModelIdentifier(identity.title, attributes);
    if (!hasStrongIdentifier(itemIdentifiers) && fallbackIdentifier) itemIdentifiers.push(fallbackIdentifier);

    output.push({
      source: 'dataforseo-google-shopping',
      sourceKey,
      merchant: { name: merchantName, domain: merchantDomain },
      title: identity.title,
      brand: identity.brand,
      model: item.model ? String(item.model) : undefined,
      category: item.category ? String(item.category) : undefined,
      description: description || originalTitle,
      url,
      image: image ? { url: String(image), source: 'dataforseo', provenance: 'variant', confidence: 0.75 } : undefined,
      identifiers: itemIdentifiers,
      attributes,
      price: amount,
      shippingPrice: Number.isFinite(shippingRaw) && shippingRaw >= 0 ? shippingRaw : undefined,
      currency: String(item.price?.currency || item.currency || 'EUR'),
      availability: item.product_availability || item.availability,
      evidence: {
        displayedPrice: item.price?.displayed_price || item.displayed_price,
        sellerText: [item.seller_name, item.seller, item.delivery_info?.delivery_message].filter(Boolean).join(' '),
        tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
        surroundingText: [originalTitle, description, keyword, item.price?.displayed_price, item.product_availability].filter(Boolean).join(' '),
        priceMultiplier: Number(item.price?.multiplier || item.installment_count || 1),
        explicitOneTime: item.is_installment === true ? false : undefined,
      },
    });
  }
  return output;
}
