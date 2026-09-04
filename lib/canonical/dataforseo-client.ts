import { providerTaskState, type IdentifierCandidate, type NormalizedOfferCandidate } from './domain.ts';

const API_BASE = 'https://api.dataforseo.com/v3';
const REQUEST_TIMEOUT_MS = Math.min(15_000, Math.max(3_000, Number(process.env.DATAFORSEO_TIMEOUT_MS || 10_000)));

type Json = Record<string, any>;

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
    for (const row of task.result) {
      if (row?.id) ids.add(String(row.id));
    }
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
  return request('/serp/google/organic/live/advanced', {
    method: 'POST',
    body: JSON.stringify([{ ...taskPayload(keyword)[0], device: 'desktop', os: 'windows', search_param: '&udm=28' }]),
  });
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
  try { return new URL(String(value)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return String(value || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]; }
}

function price(item: Json) {
  if (typeof item.price === 'number') return item.price;
  for (const value of [item.price?.current, item.price?.value, item.current_price, item.price_from]) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return NaN;
}

function identifiers(item: Json): IdentifierCandidate[] {
  const output: IdentifierCandidate[] = [];
  for (const [type, value] of [['GTIN', item.gtin], ['EAN', item.ean], ['UPC', item.upc], ['MPN', item.mpn], ['SKU_ALIAS', item.product_id || item.gid || item.data_docid]] as const) {
    if (value != null && String(value).trim()) output.push({ type, value: String(value), source: 'dataforseo', confidence: type === 'SKU_ALIAS' ? 0.7 : 0.95 });
  }
  return output;
}

function walkItems(value: unknown, output: Json[]) {
  if (Array.isArray(value)) { value.forEach((child) => walkItems(child, output)); return; }
  if (!value || typeof value !== 'object') return;
  const item = value as Json;
  if (item.title && Number.isFinite(price(item)) && (item.seller_name || item.seller || item.domain || item.url || item.shopping_url)) output.push(item);
  for (const child of Object.values(item)) if (child && typeof child === 'object') walkItems(child, output);
}

export function mapShoppingCandidates(json: Json): NormalizedOfferCandidate[] {
  const raw: Json[] = [];
  walkItems(json.tasks?.[0]?.result || [], raw);
  const seen = new Set<string>();
  const output: NormalizedOfferCandidate[] = [];
  for (const item of raw) {
    const url = String(item.url || item.shopping_url || '');
    const merchantDomain = domain(item.domain || url);
    const merchantName = String(item.seller_name || item.seller || merchantDomain || 'Merchant');
    const amount = price(item);
    const sourceKey = String(item.offer_id || item.product_id || item.gid || `${url}|${item.title}`);
    const unique = `${merchantDomain}|${sourceKey}`;
    if (!url || !merchantDomain || seen.has(unique)) continue;
    seen.add(unique);
    const shippingRaw = Number(item.delivery_info?.delivery_price?.current ?? item.shipping_price);
    const image = [...(item.product_images || []), item.image_url, ...(item.images || []).map((entry: any) => entry?.image_url || entry)].find((value) => /^https?:\/\//i.test(String(value)));
    output.push({
      source: 'dataforseo-google-shopping', sourceKey, merchant: { name: merchantName, domain: merchantDomain },
      title: String(item.title), brand: item.brand ? String(item.brand) : undefined, model: item.model ? String(item.model) : undefined,
      category: item.category ? String(item.category) : undefined, description: item.description ? String(item.description) : undefined,
      url, image: image ? { url: String(image), source: 'dataforseo', provenance: 'variant', confidence: 0.75 } : undefined,
      identifiers: identifiers(item), price: amount, shippingPrice: Number.isFinite(shippingRaw) && shippingRaw >= 0 ? shippingRaw : undefined,
      currency: String(item.price?.currency || item.currency || 'EUR'), availability: item.product_availability || item.availability,
      evidence: {
        displayedPrice: item.price?.displayed_price || item.displayed_price,
        sellerText: [item.seller_name, item.seller, item.delivery_info?.delivery_message].filter(Boolean).join(' '),
        tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
        surroundingText: [item.description, item.price?.displayed_price, item.product_availability].filter(Boolean).join(' '),
        priceMultiplier: Number(item.price?.multiplier || item.installment_count || 1),
        explicitOneTime: item.is_installment === true ? false : undefined,
      },
    });
  }
  return output;
}
