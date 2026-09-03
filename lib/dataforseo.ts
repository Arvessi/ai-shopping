import type {
  OfferView,
  ProductResult,
  VariantAttributes,
} from './types';

const API_BASE = 'https://api.dataforseo.com/v3';

const EXCLUDED_COMPARISON_DOMAINS = [
  'kurpirkt.lv',
  'salidzini.lv',
  'ceno.lv',
];

type Json = Record<string, any>;

type PriceObject = {
  current?: number | null;
  regular?: number | null;
  max_value?: number | null;
  currency?: string | null;
  displayed_price?: string | null;
  is_price_range?: boolean | null;
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
  price_multiplier?: number | null;
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
  tags?: string[] | null;
  product_identifiers?: {
    product_id?: string | null;
    data_docid?: string | null;
    gid?: string | number | null;
  } | null;
  reviews_count?: number | null;
  is_best_match?: boolean | null;
  more_sellers?: boolean | null;
  product_rating?: {
    value?: number | string;
    votes_count?: number;
    rating_max?: number;
  } | null;
  rating?: {
    value?: number | string;
    votes_count?: number;
    rating_max?: number;
  } | null;
  seller_rating?: {
    value?: number | string;
    votes_count?: number;
    rating_max?: number;
  } | null;
  delivery_info?: {
    delivery_message?: string | null;
    delivery_price?: {
      current?: number | null;
      regular?: number | null;
      max_value?: number | null;
      currency?: string | null;
      displayed_price?: string | null;
      is_price_range?: boolean | null;
    } | null;
  } | null;
  items?: RawItem[];
};

const COLOR_VARIANTS: Array<[RegExp, string]> = [
  [/\b(space black|black titanium|obsidian|black|midnight|melns|melna)\b/i, 'Black'],
  [/\b(desert titanium|desert)\b/i, 'Desert Titanium'],
  [/\b(natural titanium)\b/i, 'Natural Titanium'],
  [/\b(white titanium|porcelain|white|starlight|balts|balta)\b/i, 'White'],
  [/\b(titanium gray|space gray|gray|grey|graphite|pelēks|pelēka)\b/i, 'Gray'],
  [/\b(pink|rose gold|rose|rozā)\b/i, 'Pink'],
  [/\b(navy|blue titanium|blue|ultramarine|zils|zila)\b/i, 'Blue'],
  [/\b(mint|green|zaļš|zaļa)\b/i, 'Green'],
  [/\b(product red|red|sarkans|sarkana)\b/i, 'Red'],
  [/\b(yellow|dzeltens|dzeltena)\b/i, 'Yellow'],
  [/\b(purple|violet|violets|violeta)\b/i, 'Purple'],
  [/\b(gold|zelta)\b/i, 'Gold'],
  [/\b(silver|sudraba)\b/i, 'Silver'],
];

const KNOWN_BRANDS = [
  'Apple', 'Samsung', 'Google', 'Xiaomi', 'Huawei', 'Honor', 'OnePlus',
  'Nothing', 'Sony', 'LG', 'Philips', 'Panasonic', 'Lenovo', 'Asus',
  'Acer', 'Dell', 'HP', 'MSI', 'Microsoft', 'JBL', 'Bose', 'Marshall',
  'Logitech', 'Razer', 'Corsair', 'SteelSeries', 'Canon', 'Nikon',
  'Fujifilm', 'GoPro', 'DJI', 'Garmin', 'Bosch', 'Dyson', 'Roborock',
];

const INSTALLMENT_PATTERN =
  /(?:\/\s*mēn|mēnesī|mēnesim|mēneš|\/\s*mo\b|per\s+month|monthly|month\b|nomaks|līzing|leasing|installment|instalment|abonē|subscription|pirm[aā]\s+iemaksa|first\s+payment|down\s+payment|deposit|tarifs?|plan\s+from|\b\d+\s*[x×]\s*€|\b\d+\s*mēn)/i;

const SECONDARY_CONDITION_PATTERN =
  /\b(used|refurbished|renewed|reconditioned|open[\s-]?box|demo|lietots|lietota|atjaunots|atjaunota|mazlietots|vitrīnas)\b/i;

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

export async function searchProductsFast(keyword: string, useShoppingMarkup = true) {
  const task: Record<string, unknown> = {
    ...locationTask(),
    keyword,
    device: 'desktop',
    os: 'windows',
    depth: 10,
  };

  if (useShoppingMarkup) task.search_param = '&udm=28';

  return request('/serp/google/organic/live/advanced', {
    method: 'POST',
    body: JSON.stringify([task]),
  });
}

export async function createProductsTask(keyword: string) {
  const json = await request('/merchant/google/products/task_post', {
    method: 'POST',
    body: JSON.stringify([{
      ...locationTask(),
      keyword,
      priority: 1,
      depth: 20,
    }]),
  });

  const task = json?.tasks?.[0];
  if (!task?.id) throw new Error(task?.status_message || 'DataForSEO did not create a products task.');

  return {
    taskId: String(task.id),
    statusCode: task.status_code,
    statusMessage: task.status_message,
  };
}

export async function getProductsTask(taskId: string) {
  return request(`/merchant/google/products/task_get/advanced/${encodeURIComponent(taskId)}`);
}

export async function createSellersTask(ids: {
  productId?: string;
  gid?: string;
  dataDocId?: string;
}) {
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
    body: JSON.stringify([{
      ...locationTask(),
      priority: 1,
      ...identity,
      depth: 10,
    }]),
  });

  const task = json?.tasks?.[0];
  if (!task?.id) throw new Error(task?.status_message || 'DataForSEO did not create a sellers task.');

  return {
    taskId: String(task.id),
    statusCode: task.status_code,
    statusMessage: task.status_message,
  };
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

function cleanProductTitle(title: string) {
  return title
    .replace(/\s*[|–—]\s*.*$/i, '')
    .replace(/\s+-\s+(telefoni|phones?|smartphones?|mobile phones?|portatīvie|laptops?).*$/i, '')
    .replace(/\b(cena(?:\s+no)?|price(?:\s+from)?)\s+\d+(?:[.,]\d+)?\s*€?.*$/i, '')
    .replace(/[🏷️]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferBrand(title: string) {
  const lower = title.toLowerCase();

  if (/\biphone\b|\bipad\b|\bmacbook\b|\bairpods\b|\bapple watch\b/i.test(title)) return 'Apple';
  if (/\bgalaxy\b/i.test(title)) return 'Samsung';
  if (/\bpixel\b/i.test(title)) return 'Google';

  const brand = KNOWN_BRANDS.find((candidate) => lower.includes(candidate.toLowerCase()));
  if (brand) return brand;

  const first = title.trim().split(/\s+/)[0] || '';
  return first.length > 1 ? first.replace(/[,:;]+$/, '') : undefined;
}

function stripLeadingBrand(value: string) {
  const brand = inferBrand(value);
  if (!brand) return value;
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(`^${escaped}\\s+`, 'i'), '').trim();
}

function extractStorage(title: string) {
  const tb = title.match(/\b(\d+(?:\.\d+)?)\s*TB\b/i);
  if (tb) return `${tb[1]}TB`;

  const storage = Array.from(title.matchAll(/\b(\d{2,4})\s*GB\b/gi))
    .map((match) => Number(match[1]))
    .filter((value) => value >= 64)
    .sort((a, b) => b - a)[0];

  return storage ? `${storage}GB` : undefined;
}

function extractRam(title: string) {
  const explicit = title.match(/\b(\d{1,3})\s*GB\s*(?:RAM|memory)\b/i);
  if (explicit) return `${explicit[1]}GB`;

  const values = Array.from(title.matchAll(/\b(\d{1,4})\s*GB\b/gi))
    .map((match) => Number(match[1]));

  if (values.length >= 2) {
    const ram = values
      .filter((value) => value > 0 && value < 64)
      .sort((a, b) => b - a)[0];

    if (ram) return `${ram}GB`;
  }

  return undefined;
}

function extractColor(title: string) {
  for (const [pattern, label] of COLOR_VARIANTS) {
    if (pattern.test(title)) return label;
  }

  return undefined;
}

function extractConnectivity(title: string) {
  if (/\bwi[\s-]?fi\s*\+\s*cellular\b/i.test(title)) return 'Wi‑Fi + Cellular';
  if (/\bcellular\b|\blte\b/i.test(title)) return 'Cellular';
  if (/\b5g\b/i.test(title)) return '5G';
  if (/\bwi[\s-]?fi\b/i.test(title)) return 'Wi‑Fi';
  return undefined;
}

function extractSize(title: string) {
  const mm = title.match(/\b(\d{2,3})\s*mm\b/i);
  if (mm) return `${mm[1]}mm`;

  const inch = title.match(/\b(\d{1,3}(?:[.,]\d)?)\s*(?:inch(?:es)?|″|")\b/i);
  if (inch) return `${inch[1].replace(',', '.')}″`;

  return undefined;
}

export function extractVariantData(title: string): VariantAttributes {
  return {
    color: extractColor(title),
    storage: extractStorage(title),
    ram: extractRam(title),
    connectivity: extractConnectivity(title),
    size: extractSize(title),
    condition: SECONDARY_CONDITION_PATTERN.test(title) ? 'Refurbished / Used' : 'New',
  };
}

function compactVariantData(data: VariantAttributes): VariantAttributes {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => Boolean(value)),
  ) as VariantAttributes;
}

function variantKey(data?: VariantAttributes) {
  if (!data) return 'base';

  return Object.entries(compactVariantData(data))
    .filter(([key, value]) => !(key === 'condition' && value === 'New'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|') || 'base';
}

function variantLabel(data?: VariantAttributes) {
  if (!data) return undefined;

  const values = [
    data.storage,
    data.ram ? `${data.ram} RAM` : undefined,
    data.color,
    data.connectivity,
    data.size,
    data.condition && data.condition !== 'New' ? data.condition : undefined,
  ].filter(Boolean);

  return values.length ? values.join(' · ') : undefined;
}

function removeVariantTokens(value: string) {
  let output = value;

  for (const [pattern] of COLOR_VARIANTS) {
    output = output.replace(pattern, ' ');
  }

  output = output
    .replace(/\b(?:64|128|256|512)\s*GB\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*TB\b/gi, ' ')
    .replace(/\b\d{1,3}\s*GB\s*(?:RAM|memory)\b/gi, ' ')
    .replace(/\bwi[\s-]?fi\s*\+\s*cellular\b/gi, ' ')
    .replace(/\bcellular\b|\blte\b|\b5g\b/gi, ' ')
    .replace(/\b[A-Z0-9]{5,}[A-Z0-9/.-]*\/[A-Z0-9.-]+\b/gi, ' ');

  if (/watch/i.test(value)) {
    output = output.replace(/\b\d{2,3}\s*mm\b/gi, ' ');
  }

  return output.replace(/\s+/g, ' ').trim();
}

export function canonicalizeProductTitle(title: string) {
  let value = cleanProductTitle(title);

  value = value.replace(
    /^\s*(telefons?|smartphone|mobile phone|portatīvais dators|laptop|televizors?|tv)\s+/i,
    '',
  );

  return removeVariantTokens(value)
    .replace(/\s*[,;:-]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function productGroupIdentity(item: RawItem) {
  const canonical = canonicalizeProductTitle(item.title || 'product');
  const withoutBrand = stripLeadingBrand(canonical);
  return `family:${normalizeTitle(withoutBrand || canonical)}`;
}

function rawPriceText(item: RawItem) {
  const displayed =
    item.price && typeof item.price === 'object'
      ? item.price.displayed_price
      : undefined;

  return [
    item.title,
    item.description,
    item.snippet,
    displayed,
    item.delivery_info?.delivery_message,
    ...(item.tags || []),
  ]
    .filter(Boolean)
    .join(' ');
}

function isLikelyInstallment(item: RawItem) {
  if (typeof item.price_multiplier === 'number' && item.price_multiplier > 1) return true;
  return INSTALLMENT_PATTERN.test(rawPriceText(item));
}

function isSecondaryCondition(item: RawItem) {
  return SECONDARY_CONDITION_PATTERN.test(rawPriceText(item));
}

function isExcludedComparisonSite(item: RawItem) {
  const haystack = [
    item.domain,
    item.source,
    item.marketplace,
    item.seller,
    item.seller_name,
    item.url,
    item.shopping_url,
    item.marketplace_url,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return EXCLUDED_COMPARISON_DOMAINS.some((domain) => haystack.includes(domain));
}

function numberRating(value: unknown, max: unknown) {
  const v = Number(value);
  const m = Number(max || 5);

  if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0) {
    return undefined;
  }

  return Math.max(0, Math.min(5, (v / m) * 5));
}

function directPrice(item: RawItem) {
  if (typeof item.price === 'number') return item.price;

  if (
    item.price &&
    typeof item.price === 'object' &&
    typeof item.price.current === 'number'
  ) {
    return item.price.current;
  }

  if (typeof item.base_price === 'number') return item.base_price;
  if (typeof item.total_price === 'number') return item.total_price;

  return 0;
}

function directCurrency(item: RawItem) {
  if (
    item.price &&
    typeof item.price === 'object' &&
    item.price.currency
  ) {
    return item.price.currency;
  }

  return item.currency || item.delivery_info?.delivery_price?.currency || 'EUR';
}

function pickImage(item: RawItem) {
  const candidates = [
    ...(item.product_images || []),
    item.image_url,
    ...(item.images || []).map((image) => image.image_url),
  ].filter(Boolean) as string[];

  return candidates.find((url) => /^https?:\/\//i.test(url));
}

function identifiers(item: RawItem) {
  return {
    productId:
      item.product_id ||
      item.product_identifiers?.product_id ||
      undefined,
    gid:
      item.gid != null
        ? String(item.gid)
        : item.product_identifiers?.gid != null
          ? String(item.product_identifiers.gid)
          : undefined,
    dataDocId:
      item.data_docid ||
      item.product_identifiers?.data_docid ||
      undefined,
  };
}

function isProductLike(item: RawItem) {
  if (!item.title || directPrice(item) <= 0) return false;
  if (isExcludedComparisonSite(item)) return false;

  const type = String(item.type || '').toLowerCase();

  if (
    type.includes('shopping') ||
    type.includes('popular_products') ||
    type.includes('commercial_units') ||
    type.includes('product')
  ) {
    return true;
  }

  if (type === 'organic' || type === 'paid') {
    return Boolean(
      item.domain ||
        item.seller ||
        item.seller_name ||
        item.url ||
        item.shopping_url,
    );
  }

  return false;
}

function collectProductItems(
  value: unknown,
  output: RawItem[] = [],
): RawItem[] {
  if (Array.isArray(value)) {
    for (const child of value) {
      collectProductItems(child, output);
    }

    return output;
  }

  if (!value || typeof value !== 'object') return output;

  const item = value as RawItem;

  if (isProductLike(item)) {
    output.push(item);
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    if (
      child &&
      (Array.isArray(child) || typeof child === 'object')
    ) {
      collectProductItems(child, output);
    }
  }

  return output;
}

function merchantFromUrl(url?: string | null) {
  if (!url) return undefined;

  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return undefined;
  }
}

function merchantName(item: RawItem) {
  const candidates = [
    item.seller_name,
    item.seller,
    item.domain,
    merchantFromUrl(item.url || item.shopping_url || item.marketplace_url),
    item.source,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || '').trim();

    if (!value) continue;
    if (/^(no|from|cena|price|buy|shop)$/i.test(value)) continue;
    if (/google shopping/i.test(value)) continue;

    return value.replace(/^www\./i, '');
  }

  return 'Veikals';
}

function toOffer(
  item: RawItem,
): Omit<
  OfferView,
  'dealScore' | 'isCheapest' | 'isBestOverall'
> {
  const price = directPrice(item);

  const shippingRaw =
    item.delivery_info?.delivery_price?.current ??
    item.shipping_price;

  const shippingKnown =
    typeof shippingRaw === 'number' ||
    /free|bezmaksas/i.test(item.delivery_info?.delivery_message || '');

  const shipping =
    typeof shippingRaw === 'number' && shippingRaw > 0
      ? shippingRaw
      : 0;

  const explicitTotal =
    typeof item.total_price === 'number' &&
    item.total_price > 0
      ? item.total_price
      : undefined;

  const variantData = compactVariantData(
    extractVariantData(item.title || ''),
  );

  return {
    merchant: merchantName(item),
    merchantDomain:
      item.domain ||
      merchantFromUrl(item.url || item.shopping_url || item.marketplace_url),
    variantLabel: variantLabel(variantData),
    variantData,
    price,
    shipping,
    shippingKnown,
    totalPrice: explicitTotal ?? price + shipping,
    currency: directCurrency(item),
    sellerRating: numberRating(
      item.seller_rating?.value ??
        item.rating?.value ??
        item.product_rating?.value,
      item.seller_rating?.rating_max ??
        item.rating?.rating_max ??
        item.product_rating?.rating_max,
    ),
    sellerVotes:
      item.seller_rating?.votes_count ??
      item.rating?.votes_count ??
      item.product_rating?.votes_count ??
      item.reviews_count ??
      undefined,
    deliveryMessage:
      item.delivery_info?.delivery_message || undefined,
    url:
      item.url ||
      item.shopping_url ||
      item.marketplace_url ||
      undefined,
  };
}

function offerMerchantKey(
  offer: Omit<
    OfferView,
    'dealScore' | 'isCheapest' | 'isBestOverall'
  >,
) {
  return (offer.merchantDomain || offer.merchant || 'unknown')
    .toLowerCase()
    .replace(/^www\./, '');
}

function median(values: number[]) {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function cleanGroupItems(items: RawItem[]) {
  const base = items.filter(
    (item) =>
      !isExcludedComparisonSite(item) &&
      !isLikelyInstallment(item) &&
      !isSecondaryCondition(item) &&
      directPrice(item) > 0,
  );

  if (base.length < 2) return base;

  const prices = base.map(directPrice).filter((price) => price > 0);
  const med = median(prices);

  if (med < 100) return base;

  return base.filter((item) => {
    const price = directPrice(item);
    const crediblePeers = prices.filter((peer) => peer >= med * 0.7);

    if (crediblePeers.length >= 1 && price < med * 0.4) {
      return false;
    }

    return true;
  });
}

function scoreOffer(
  total: number,
  minTotal: number,
  maxTotal: number,
  rating?: number,
  sellerVotes?: number,
  deliveryKnown = false,
  storeCount = 1,
) {
  if (storeCount < 2) return 0;

  const pricePosition =
    maxTotal === minTotal
      ? 0.5
      : (maxTotal - total) / (maxTotal - minTotal);

  let score = 55 + pricePosition * 35;

  if (rating != null) {
    score += Math.max(-5, Math.min(5, (rating - 4) * 5));
  }

  if (sellerVotes && sellerVotes >= 50) score += 2;
  if (deliveryKnown) score += 1;
  if (storeCount >= 4) score += 2;

  return Math.round(Math.max(45, Math.min(96, score)));
}

function scoreOffersByVariant(
  rawOffers: Array<
    Omit<
      OfferView,
      'dealScore' | 'isCheapest' | 'isBestOverall'
    >
  >,
) {
  const byVariant = new Map<
    string,
    Array<
      Omit<
        OfferView,
        'dealScore' | 'isCheapest' | 'isBestOverall'
      >
    >
  >();

  for (const offer of rawOffers) {
    const key = variantKey(offer.variantData);

    byVariant.set(key, [
      ...(byVariant.get(key) || []),
      offer,
    ]);
  }

  const scored: OfferView[] = [];

  for (const group of byVariant.values()) {
    const merchantCount = new Set(group.map(offerMerchantKey)).size;
    const totals = group.map((offer) => offer.totalPrice);
    const min = Math.min(...totals);
    const max = Math.max(...totals);

    const groupScored: OfferView[] = group.map((offer) => ({
      ...offer,
      dealScore: scoreOffer(
        offer.totalPrice,
        min,
        max,
        offer.sellerRating,
        offer.sellerVotes,
        Boolean(offer.shippingKnown),
        merchantCount,
      ),
      isCheapest: offer.totalPrice === min,
      isBestOverall: false,
    }));

    if (merchantCount >= 2) {
      let bestIndex = 0;

      groupScored.forEach((offer, index) => {
        if (offer.dealScore > groupScored[bestIndex].dealScore) {
          bestIndex = index;
        }
      });

      groupScored[bestIndex].isBestOverall = true;
    }

    scored.push(...groupScored);
  }

  return scored.sort(
    (a, b) =>
      (b.isBestOverall ? 1 : 0) -
        (a.isBestOverall ? 1 : 0) ||
      a.totalPrice - b.totalPrice,
  );
}

function buildVariantOptions(offers: OfferView[]) {
  const map = new Map<string, Set<string>>();

  for (const offer of offers) {
    for (const [key, value] of Object.entries(offer.variantData || {})) {
      if (!value) continue;
      if (key === 'condition' && value === 'New') continue;

      if (!map.has(key)) {
        map.set(key, new Set());
      }

      map.get(key)!.add(value);
    }
  }

  return Object.fromEntries(
    Array.from(map.entries()).map(([key, values]) => [
      key,
      Array.from(values),
    ]),
  );
}

export function mapFastProductSearch(json: Json): ProductResult[] {
  const task = json?.tasks?.[0];

  if (!task) return [];

  if (
    typeof task.status_code === 'number' &&
    task.status_code >= 40000
  ) {
    throw new Error(
      task.status_message || 'DataForSEO Live search failed.',
    );
  }

  const rawItems = collectProductItems(task.result || []);
  const groups = new Map<string, RawItem[]>();

  for (const item of rawItems) {
    const key = productGroupIdentity(item);

    groups.set(key, [
      ...(groups.get(key) || []),
      item,
    ]);
  }

  const products: ProductResult[] = [];

  for (const [key, originalItems] of groups.entries()) {
    const items = cleanGroupItems(originalItems);

    if (!items.length) continue;

    const sortedItems = [...items].sort(
      (a, b) => directPrice(a) - directPrice(b),
    );

    const first = sortedItems[0];

    if (!first) continue;

    const identityItem =
      sortedItems.find((item) => {
        const ids = identifiers(item);

        return Boolean(
          ids.productId || ids.gid || ids.dataDocId,
        );
      }) || first;

    const visualItem =
      sortedItems.find((item) => Boolean(pickImage(item))) || first;

    const ids = identifiers(identityItem);

    const unique = new Map<
      string,
      Omit<
        OfferView,
        'dealScore' | 'isCheapest' | 'isBestOverall'
      >
    >();

    for (const item of sortedItems) {
      const offer = toOffer(item);

      const keyForOffer = `${offerMerchantKey(
        offer,
      )}|${variantKey(offer.variantData)}`;

      const existing = unique.get(keyForOffer);

      if (
        !existing ||
        offer.totalPrice < existing.totalPrice
      ) {
        unique.set(keyForOffer, offer);
      }
    }

    const rawOffers = Array.from(unique.values());

    if (!rawOffers.length) continue;

    const offers = scoreOffersByVariant(rawOffers);

    const bestPrice = Math.min(
      ...offers.map((offer) => offer.totalPrice),
    );

    const familyTitle = canonicalizeProductTitle(
      first.title || 'Produkts',
    );

    const brand = inferBrand(
      sortedItems.map((item) => item.title || '').join(' '),
    );

    const displayTitle =
      brand &&
      !familyTitle.toLowerCase().startsWith(brand.toLowerCase())
        ? `${brand} ${familyTitle}`
        : familyTitle;

    const storeCount = new Set(offers.map(offerMerchantKey)).size;

    const dealScores = offers
      .map((offer) => offer.dealScore)
      .filter((score) => score > 0);

    products.push({
      id: key,
      externalId: key,
      sourceProductId: ids.productId,
      gid: ids.gid,
      dataDocId: ids.dataDocId,
      title: displayTitle,
      normalizedTitle: normalizeTitle(displayTitle),
      brand,
      category: 'Elektronika',
      description:
        first.description || first.snippet || undefined,
      image: pickImage(visualItem),
      bestPrice,
      currency:
        offers[0]?.currency || directCurrency(first),
      dealScore:
        dealScores.length ? Math.max(...dealScores) : 0,
      offers,
      storesCount: storeCount,
      variants: Array.from(
        new Set(
          offers
            .map((offer) => offer.variantLabel)
            .filter(Boolean) as string[],
        ),
      ).slice(0, 12),
      variantOptions: buildVariantOptions(offers),
    });
  }

  return products
    .filter(
      (product) =>
        Number.isFinite(product.bestPrice) &&
        product.bestPrice > 0,
    )
    .sort((a, b) => {
      const coverage =
        (b.storesCount || 0) - (a.storesCount || 0);

      if (coverage) return coverage;

      return (
        b.dealScore - a.dealScore ||
        a.bestPrice - b.bestPrice
      );
    })
    .slice(0, 24);
}

function flattenMerchant(items: RawItem[] = []): RawItem[] {
  const output: RawItem[] = [];

  for (const item of items) {
    if (item && typeof item === 'object') {
      if (item.title && directPrice(item) > 0) {
        output.push(item);
      }

      if (Array.isArray(item.items)) {
        output.push(...flattenMerchant(item.items));
      }
    }
  }

  return output;
}

export function mapSellerOffers(json: Json): OfferView[] {
  const task = json?.tasks?.[0];

  if (!task) return [];

  if (
    task.status_code >= 40000 &&
    task.status_code !== 40601 &&
    task.status_code !== 40602
  ) {
    throw new Error(
      task.status_message || 'DataForSEO seller task failed.',
    );
  }

  const raw: RawItem[] = (task.result || []).flatMap(
    (result: Json) => flattenMerchant(result?.items || []),
  );

  const cleaned = cleanGroupItems(raw);

  const unique = new Map<
    string,
    Omit<
      OfferView,
      'dealScore' | 'isCheapest' | 'isBestOverall'
    >
  >();

  for (const item of cleaned) {
    const offer = toOffer(item);
    const key = `${offerMerchantKey(offer)}|${variantKey(
      offer.variantData,
    )}`;

    const existing = unique.get(key);

    if (
      !existing ||
      offer.totalPrice < existing.totalPrice
    ) {
      unique.set(key, offer);
    }
  }

  return scoreOffersByVariant(Array.from(unique.values()));
}

function tokenSet(value: string) {
  return new Set(
    normalizeTitle(value)
      .split(' ')
      .filter((token) => token.length > 1),
  );
}

function similarity(a: string, b: string) {
  const left = tokenSet(
    stripLeadingBrand(canonicalizeProductTitle(a)),
  );

  const right = tokenSet(
    stripLeadingBrand(canonicalizeProductTitle(b)),
  );

  if (!left.size || !right.size) return 0;

  let common = 0;

  for (const token of left) {
    if (right.has(token)) common += 1;
  }

  return common / Math.max(left.size, right.size);
}

export type MerchantProductCandidate = {
  title: string;
  image?: string;
  productId?: string;
  gid?: string;
  dataDocId?: string;
  variantData?: VariantAttributes;
};

export function selectMerchantProductCandidate(
  json: Json,
  expectedTitle: string,
): MerchantProductCandidate | null {
  const task = json?.tasks?.[0];

  if (!task || taskPending(json)) return null;

  const raw: RawItem[] = (task.result || []).flatMap(
    (result: Json) => flattenMerchant(result?.items || []),
  );

  const candidates = raw
    .filter(
      (item) =>
        !isLikelyInstallment(item) &&
        !isSecondaryCondition(item),
    )
    .map((item) => {
      const ids = identifiers(item);

      return {
        item,
        ids,
        score:
          similarity(item.title || '', expectedTitle) +
          (item.is_best_match ? 0.25 : 0) +
          (ids.productId || ids.gid || ids.dataDocId
            ? 0.1
            : 0),
      };
    })
    .filter(
      (candidate) =>
        candidate.ids.productId ||
        candidate.ids.gid ||
        candidate.ids.dataDocId,
    )
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];

  if (!best || best.score < 0.45) return null;

  return {
    title: best.item.title || expectedTitle,
    image: pickImage(best.item),
    productId: best.ids.productId,
    gid: best.ids.gid,
    dataDocId: best.ids.dataDocId,
    variantData: extractVariantData(best.item.title || ''),
  };
}

export function taskPending(json: Json) {
  const task = json?.tasks?.[0];

  if (!task) return true;

  return (
    task.status_code === 40601 ||
    task.status_code === 40602 ||
    !Array.isArray(task.result)
  );
}
