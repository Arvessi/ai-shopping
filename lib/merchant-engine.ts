import { createHash } from 'crypto';
import { prisma } from '@/lib/db';
import {
  canonicalizeProductTitle,
  extractVariantData,
} from '@/lib/dataforseo';
import type {
  OfferView,
  ProductResult,
  VariantAttributes,
} from '@/lib/types';
import {
  LATVIA_ELECTRONICS_STORES,
  ALLOWED_MERCHANT_DOMAINS,
} from '@/lib/store-registry';

type Json = Record<string, any>;

type RawMerchantItem = {
  title?: string;
  description?: string;
  domain?: string;
  seller?: string;
  seller_name?: string;
  url?: string;
  shopping_url?: string;
  price?: number | {
    current?: number | null;
    regular?: number | null;
    max_value?: number | null;
    currency?: string | null;
    displayed_price?: string | null;
  };
  total_price?: number | null;
  base_price?: number | null;
  old_price?: number | null;
  currency?: string | null;
  price_multiplier?: number | null;
  product_id?: string | null;
  data_docid?: string | null;
  gid?: string | number | null;
  image_url?: string | null;
  product_images?: string[] | null;
  images?: Array<{ image_url?: string | null }> | null;
  rating?: any;
  seller_rating?: any;
  product_rating?: any;
  reviews_count?: number | null;
  delivery_info?: any;
  items?: RawMerchantItem[];
  type?: string;
  is_best_match?: boolean;
};

const CONDITION_BAD =
  /\b(used|refurbished|renewed|reconditioned|open[\s-]?box|demo|lietots|lietota|atjaunots|atjaunota|mazlietots|vitrīnas)\b/i;

const INSTALLMENT_BAD =
  /(?:\/\s*mēn|mēnesī|mēneš|\/\s*mo\b|per\s+month|monthly|nomaks|līzing|leasing|installment|instalment|abonē|subscription|pirm[aā]\s+iemaksa|down\s+payment|deposit|\b\d+\s*mēn)/i;

const BRAND_HINTS = [
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

function cleanPunctuation(value: string) {
  return value
    .replace(/\s*[,;:|/\\-]+\s*(?=[,;:|/\\-]|$)/g, ' ')
    .replace(/^[\s,;:|/\\-]+|[\s,;:|/\\-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeDomain(value?: string | null) {
  if (!value) return '';

  try {
    return new URL(
      value.includes('://') ? value : `https://${value}`,
    ).hostname
      .replace(/^www\./i, '')
      .toLowerCase();
  } catch {
    return String(value)
      .replace(/^www\./i, '')
      .toLowerCase()
      .split('/')[0];
  }
}

function merchantAllowed(domain: string, seller?: string) {
  const normalized = safeDomain(domain);

  if (
    normalized &&
    ALLOWED_MERCHANT_DOMAINS.some(
      (allowed) =>
        normalized === allowed ||
        normalized.endsWith(`.${allowed}`) ||
        allowed.endsWith(`.${normalized}`),
    )
  ) {
    return true;
  }

  const sellerNorm = normalize(seller || '').replace(/\s/g, '');

  return LATVIA_ELECTRONICS_STORES.some((store) => {
    const names = [
      store.name,
      store.slug,
      store.domain,
    ].map((value) => normalize(value).replace(/\s/g, ''));

    return names.some(
      (name) =>
        name &&
        sellerNorm &&
        (sellerNorm === name ||
          sellerNorm.startsWith(name) ||
          name.startsWith(sellerNorm)),
    );
  });
}

function inferBrand(title: string) {
  if (/\biphone\b|\bipad\b|\bmacbook\b|\bairpods\b|\bapple watch\b/i.test(title)) {
    return 'Apple';
  }

  if (/\bgalaxy\b/i.test(title)) return 'Samsung';
  if (/\bpixel\b/i.test(title)) return 'Google';

  const lower = title.toLowerCase();
  return BRAND_HINTS.find((brand) => lower.includes(brand.toLowerCase()));
}

function stableFamilyTitle(title: string) {
  let value = cleanPunctuation(canonicalizeProductTitle(title) || title);
  const brand = inferBrand(value || title);

  if (brand) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    value = value
      .replace(new RegExp(`^${escaped}\\s+`, 'i'), '')
      .replace(new RegExp(`\\s+${escaped}$`, 'i'), '')
      .trim();

    value = `${brand} ${value}`;
  }

  return cleanPunctuation(value);
}

export function familyQuery(query: string) {
  return stableFamilyTitle(query);
}

function familyExternalId(title: string) {
  return `market:${hash(normalize(stableFamilyTitle(title)))}`;
}

function directPrice(item: RawMerchantItem) {
  if (typeof item.total_price === 'number' && item.total_price > 0) {
    return item.total_price;
  }

  if (typeof item.base_price === 'number' && item.base_price > 0) {
    return item.base_price;
  }

  if (typeof item.price === 'number') return item.price;

  if (
    item.price &&
    typeof item.price === 'object' &&
    typeof item.price.current === 'number'
  ) {
    return item.price.current;
  }

  return 0;
}

function displayedPrice(item: RawMerchantItem) {
  return item.price && typeof item.price === 'object'
    ? String(item.price.displayed_price || '')
    : '';
}

function badPrice(item: RawMerchantItem) {
  const text = [
    item.title,
    item.description,
    displayedPrice(item),
  ]
    .filter(Boolean)
    .join(' ');

  if (
    typeof item.price_multiplier === 'number' &&
    item.price_multiplier > 1
  ) {
    return true;
  }

  return INSTALLMENT_BAD.test(text);
}

function conditionBad(item: RawMerchantItem) {
  return CONDITION_BAD.test(
    [item.title, item.description, displayedPrice(item)]
      .filter(Boolean)
      .join(' '),
  );
}

function imageOf(item: RawMerchantItem) {
  const candidates = [
    ...(item.product_images || []),
    item.image_url,
    ...(item.images || []).map((image) => image.image_url),
  ].filter(Boolean) as string[];

  return candidates.find((url) => /^https?:\/\//i.test(url));
}

function merchantName(item: RawMerchantItem) {
  const value =
    item.seller_name ||
    item.seller ||
    item.domain ||
    safeDomain(item.url || item.shopping_url);

  return String(value || 'Veikals').replace(/^www\./i, '');
}

function merchantDomain(item: RawMerchantItem) {
  return (
    safeDomain(item.domain) ||
    safeDomain(item.url || item.shopping_url)
  );
}

function identifiers(item: RawMerchantItem) {
  return {
    productId: item.product_id ? String(item.product_id) : undefined,
    gid:
      item.gid != null ? String(item.gid) : undefined,
    dataDocId: item.data_docid ? String(item.data_docid) : undefined,
  };
}

function ratingValue(value: any) {
  const number = Number(value?.value);
  const max = Number(value?.rating_max || 5);

  if (!Number.isFinite(number) || !Number.isFinite(max) || max <= 0) {
    return undefined;
  }

  return Math.max(0, Math.min(5, (number / max) * 5));
}

function toOffer(item: RawMerchantItem): OfferView | null {
  const price = directPrice(item);

  if (!price || price <= 0 || badPrice(item) || conditionBad(item)) {
    return null;
  }

  const seller = merchantName(item);
  const domain = merchantDomain(item);

  if (!merchantAllowed(domain, seller)) {
    return null;
  }

  const variantData = extractVariantData(item.title || '');
  const variantLabel = [
    variantData.storage,
    variantData.ram ? `${variantData.ram} RAM` : undefined,
    variantData.color,
    variantData.connectivity,
    variantData.size,
  ]
    .filter(Boolean)
    .join(' · ');

  const shippingRaw =
    item.delivery_info?.delivery_price?.current;

  const shippingKnown = typeof shippingRaw === 'number';
  const shipping = shippingKnown && shippingRaw > 0 ? shippingRaw : 0;

  return {
    merchant: seller,
    merchantDomain: domain || undefined,
    variantLabel: variantLabel || undefined,
    variantData,
    image: imageOf(item),
    price,
    shipping,
    shippingKnown,
    totalPrice: price + shipping,
    currency:
      (item.price &&
      typeof item.price === 'object' &&
      item.price.currency
        ? item.price.currency
        : item.currency) || 'EUR',
    sellerRating: ratingValue(
      item.seller_rating || item.rating || item.product_rating,
    ),
    sellerVotes:
      item.seller_rating?.votes_count ||
      item.rating?.votes_count ||
      item.product_rating?.votes_count ||
      item.reviews_count ||
      undefined,
    deliveryMessage:
      item.delivery_info?.delivery_message || undefined,
    url: item.url || item.shopping_url || undefined,
    dealScore: 0,
    isCheapest: false,
    isBestOverall: false,
  };
}

function variantSignature(offer: OfferView) {
  return Object.entries(offer.variantData || {})
    .filter(
      ([key, value]) =>
        Boolean(value) && !(key === 'condition' && value === 'New'),
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${normalize(String(value))}`)
    .join('|') || 'base';
}

function merchantKey(offer: OfferView) {
  return safeDomain(offer.merchantDomain) || normalize(offer.merchant);
}

function scoreOffers(offers: OfferView[]) {
  const byVariant = new Map<string, OfferView[]>();

  for (const offer of offers) {
    const key = variantSignature(offer);
    byVariant.set(key, [...(byVariant.get(key) || []), offer]);
  }

  const output: OfferView[] = [];

  for (const group of byVariant.values()) {
    const merchants = new Set(group.map(merchantKey));
    const prices = group
      .map((offer) => offer.totalPrice)
      .sort((a, b) => a - b);

    const reference =
      prices.length % 2
        ? prices[Math.floor(prices.length / 2)]
        : prices.length
          ? (prices[prices.length / 2 - 1] +
              prices[prices.length / 2]) /
            2
          : 0;

    const min = prices[0] || 0;

    const scored = group.map((offer) => {
      if (merchants.size < 2 || !reference) {
        return {
          ...offer,
          dealScore: 0,
          isCheapest: false,
          isBestOverall: false,
        };
      }

      const relative = (reference - offer.totalPrice) / reference;
      let score = 82 + relative * 150;

      if (offer.sellerRating != null) {
        score += Math.max(
          -2,
          Math.min(2, (offer.sellerRating - 4) * 2),
        );
      }

      score = Math.round(Math.max(60, Math.min(94, score)));

      return {
        ...offer,
        dealScore: score,
        isCheapest: Math.abs(offer.totalPrice - min) < 0.001,
        isBestOverall: false,
      };
    });

    if (scored.length >= 2) {
      let best = 0;
      scored.forEach((offer, index) => {
        if (offer.dealScore > scored[best].dealScore) {
          best = index;
        }
      });

      scored[best] = {
        ...scored[best],
        isBestOverall: true,
      };
    }

    output.push(...scored);
  }

  return output.sort(
    (a, b) =>
      Number(b.isBestOverall) -
        Number(a.isBestOverall) ||
      a.totalPrice - b.totalPrice,
  );
}

function flattenItems(value: unknown, output: RawMerchantItem[] = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => flattenItems(item, output));
    return output;
  }

  if (!value || typeof value !== 'object') return output;

  const item = value as RawMerchantItem;

  if (
    item.title &&
    directPrice(item) > 0 &&
    (item.seller ||
      item.seller_name ||
      item.domain ||
      item.url ||
      item.shopping_url)
  ) {
    output.push(item);
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child && typeof child === 'object') {
      flattenItems(child, output);
    }
  }

  return output;
}

function relevance(title: string, expected: string) {
  const actualFamily = normalize(stableFamilyTitle(title));
  const expectedFamily = normalize(stableFamilyTitle(expected));

  const expectedTokens = expectedFamily.split(' ').filter(Boolean);
  const actualTokens = new Set(actualFamily.split(' ').filter(Boolean));

  if (!expectedTokens.length) return 0;

  const matched = expectedTokens.filter((token) => actualTokens.has(token)).length;
  let score = matched / expectedTokens.length;

  if (actualFamily === expectedFamily) score += 0.35;

  const modifiers = [
    'pro',
    'max',
    'plus',
    'ultra',
    'fe',
    'edge',
    'fold',
    'flip',
  ];

  for (const modifier of modifiers) {
    if (
      actualTokens.has(modifier) &&
      !expectedTokens.includes(modifier)
    ) {
      score -= 0.4;
    }
  }

  return score;
}

function buildProducts(items: RawMerchantItem[], expectedQuery: string) {
  const groups = new Map<
    string,
    {
      title: string;
      brand?: string;
      image?: string;
      ids: {
        productId?: string;
        gid?: string;
        dataDocId?: string;
      };
      offers: OfferView[];
      relevance: number;
    }
  >();

  for (const item of items) {
    if (badPrice(item) || conditionBad(item)) continue;

    const title = String(item.title || '').trim();
    if (!title) continue;

    const itemRelevance = relevance(title, expectedQuery);
    if (itemRelevance < 0.55) continue;

    const offer = toOffer(item);
    if (!offer) continue;

    const titleFamily = stableFamilyTitle(title);
    const key = normalize(titleFamily);
    const ids = identifiers(item);

    const current = groups.get(key);

    if (!current) {
      groups.set(key, {
        title: titleFamily,
        brand: inferBrand(title),
        image: imageOf(item),
        ids,
        offers: [offer],
        relevance: itemRelevance,
      });
    } else {
      current.offers.push(offer);
      current.image ||= imageOf(item);

      if (
        !current.ids.productId &&
        (ids.productId || ids.gid || ids.dataDocId)
      ) {
        current.ids = ids;
      }

      current.relevance = Math.max(current.relevance, itemRelevance);
    }
  }

  const results: ProductResult[] = [];

  for (const group of groups.values()) {
    const deduped = new Map<string, OfferView>();

    for (const offer of group.offers) {
      const key = `${merchantKey(offer)}|${variantSignature(offer)}`;
      const existing = deduped.get(key);

      if (!existing || offer.totalPrice < existing.totalPrice) {
        deduped.set(key, offer);
      }
    }

    let offers = Array.from(deduped.values());

    if (offers.length >= 2) {
      const prices = offers.map((offer) => offer.totalPrice).sort((a, b) => a - b);
      const reference =
        prices.length === 2
          ? prices[1]
          : prices[Math.floor(prices.length / 2)];

      offers = offers.filter(
        (offer) =>
          reference < 100 ||
          offer.totalPrice >= reference * 0.38,
      );
    }

    offers = scoreOffers(offers);

    if (!offers.length) continue;

    const storesCount = new Set(offers.map(merchantKey)).size;
    const meaningful = offers
      .map((offer) => offer.dealScore)
      .filter((score) => score > 0);

    results.push({
      id: familyExternalId(group.title),
      externalId: familyExternalId(group.title),
      sourceProductId: group.ids.productId,
      gid: group.ids.gid,
      dataDocId: group.ids.dataDocId,
      title: group.title,
      normalizedTitle: normalize(group.title),
      brand: group.brand,
      category: 'Elektronika',
      image:
        group.image ||
        offers.find((offer) => Boolean(offer.image))?.image,
      bestPrice: Math.min(...offers.map((offer) => offer.totalPrice)),
      currency: offers[0]?.currency || 'EUR',
      dealScore: meaningful.length ? Math.max(...meaningful) : 0,
      offers,
      storesCount,
      variants: Array.from(
        new Set(
          offers
            .map((offer) => offer.variantLabel)
            .filter(Boolean) as string[],
        ),
      ),
      variantOptions: buildVariantOptions(offers),
    });
  }

  return results
    .sort(
      (a, b) =>
        (b.storesCount || 0) -
          (a.storesCount || 0) ||
        a.bestPrice - b.bestPrice,
    )
    .slice(0, 10);
}

function buildVariantOptions(offers: OfferView[]) {
  const map = new Map<string, Set<string>>();

  for (const offer of offers) {
    for (const [key, value] of Object.entries(offer.variantData || {})) {
      if (!value) continue;
      if (key === 'condition' && value === 'New') continue;

      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(String(value));
    }
  }

  return Object.fromEntries(
    Array.from(map.entries()).map(([key, values]) => [
      key,
      Array.from(values),
    ]),
  );
}

export function mapMerchantProductsTask(
  json: Json,
  expectedQuery: string,
) {
  return buildProducts(flattenItems(json?.tasks?.[0]?.result || []), expectedQuery);
}

function productInfoObject(json: Json) {
  const root = json?.tasks?.[0]?.result || [];

  const candidates: any[] = [];

  function walk(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (!value || typeof value !== 'object') return;

    const item = value as Record<string, any>;

    if (
      item.title &&
      (Array.isArray(item.sellers) ||
        Array.isArray(item.variations) ||
        Array.isArray(item.images))
    ) {
      candidates.push(item);
    }

    Object.values(item).forEach((child) => {
      if (child && typeof child === 'object') walk(child);
    });
  }

  walk(root);

  return candidates[0] || null;
}

export function mapProductInfoTask(
  json: Json,
  expectedQuery: string,
): ProductResult[] {
  const info = productInfoObject(json);

  if (!info?.title) return [];

  const title = String(info.title);
  const familyTitle = stableFamilyTitle(title);

  if (relevance(familyTitle, expectedQuery) < 0.55) return [];

  const variantData = extractVariantData(title);
  const variantLabel = [
    variantData.storage,
    variantData.ram ? `${variantData.ram} RAM` : undefined,
    variantData.color,
    variantData.connectivity,
    variantData.size,
  ]
    .filter(Boolean)
    .join(' · ');

  const image = Array.isArray(info.images)
    ? info.images.find((value: unknown) => typeof value === 'string')
    : undefined;

  const offers: OfferView[] = [];

  for (const seller of Array.isArray(info.sellers) ? info.sellers : []) {
    const url = String(seller?.url || '');
    const domain = safeDomain(url);
    const name = String(seller?.title || domain || 'Veikals');

    if (!merchantAllowed(domain, name)) continue;

    const displayed = String(seller?.price?.displayed_price || '');

    if (INSTALLMENT_BAD.test(displayed) || CONDITION_BAD.test(displayed)) {
      continue;
    }

    const price = Number(seller?.price?.current);

    if (!Number.isFinite(price) || price <= 0) continue;

    const shippingRaw = Number(seller?.delivery_info?.delivery_price?.current);
    const shippingKnown = Number.isFinite(shippingRaw);
    const shipping = shippingKnown && shippingRaw > 0 ? shippingRaw : 0;

    if (
      String(seller?.product_availability || '').toLowerCase() ===
      'out_of_stock'
    ) {
      continue;
    }

    offers.push({
      merchant: name,
      merchantDomain: domain || undefined,
      variantLabel: variantLabel || undefined,
      variantData,
      image,
      price,
      shipping,
      shippingKnown,
      totalPrice: price + shipping,
      currency: seller?.price?.currency || 'EUR',
      sellerRating: ratingValue(seller?.seller_rating),
      sellerVotes:
        seller?.seller_rating?.votes_count ||
        seller?.seller_reviews_count ||
        seller?.seller_review_count ||
        undefined,
      deliveryMessage:
        seller?.delivery_info?.delivery_message ||
        seller?.product_availability ||
        undefined,
      url: url || undefined,
      dealScore: 0,
      isCheapest: false,
      isBestOverall: false,
    });
  }

  const scored = scoreOffers(offers);

  if (!scored.length) return [];

  const ids = {
    productId: info.product_id ? String(info.product_id) : undefined,
    gid: info.gid ? String(info.gid) : undefined,
    dataDocId: info.data_docid ? String(info.data_docid) : undefined,
  };

  const storesCount = new Set(scored.map(merchantKey)).size;
  const meaningful = scored
    .map((offer) => offer.dealScore)
    .filter((score) => score > 0);

  return [
    {
      id: familyExternalId(familyTitle),
      externalId: familyExternalId(familyTitle),
      sourceProductId: ids.productId,
      gid: ids.gid,
      dataDocId: ids.dataDocId,
      title: familyTitle,
      normalizedTitle: normalize(familyTitle),
      brand: inferBrand(familyTitle),
      category: 'Elektronika',
      image:
        typeof image === 'string'
          ? image
          : scored.find((offer) => Boolean(offer.image))?.image,
      bestPrice: Math.min(...scored.map((offer) => offer.totalPrice)),
      currency: scored[0]?.currency || 'EUR',
      dealScore: meaningful.length ? Math.max(...meaningful) : 0,
      offers: scored,
      storesCount,
      variants: variantLabel ? [variantLabel] : [],
      variantOptions: buildVariantOptions(scored),
    },
  ];
}

function mergeOffers(
  current: OfferView[],
  incoming: OfferView[],
) {
  const map = new Map<string, OfferView>();

  for (const offer of [...current, ...incoming]) {
    const key = `${merchantKey(offer)}|${variantSignature(offer)}`;
    const existing = map.get(key);

    if (!existing || offer.totalPrice < existing.totalPrice) {
      map.set(key, offer);
    }
  }

  return scoreOffers(Array.from(map.values()));
}

function dbOfferToView(offer: any): OfferView {
  return {
    id: offer.id,
    merchant: offer.merchant,
    merchantDomain: offer.merchantDomain || undefined,
    variantLabel: offer.variantLabel || undefined,
    variantData:
      (offer.variantData as VariantAttributes | null) || undefined,
    image: offer.image || undefined,
    price: offer.price,
    shipping: offer.shipping,
    shippingKnown: offer.shippingKnown,
    totalPrice: offer.totalPrice,
    currency: offer.currency,
    sellerRating: offer.sellerRating || undefined,
    sellerVotes: offer.sellerVotes || undefined,
    deliveryMessage: offer.deliveryMessage || undefined,
    url: offer.rawUrl || undefined,
    dealScore: offer.dealScore,
    isCheapest: offer.isCheapest,
    isBestOverall: offer.isBestOverall,
  };
}

export async function persistMarketProducts(products: ProductResult[]) {
  const saved: ProductResult[] = [];

  for (const product of products) {
    const existing = await prisma.product.findUnique({
      where: { externalId: product.externalId },
      include: { offers: true },
    });

    const mergedOffers = mergeOffers(
      existing?.offers.map(dbOfferToView) || [],
      product.offers,
    );

    if (!mergedOffers.length) continue;

    const bestPrice = Math.min(
      ...mergedOffers.map((offer) => offer.totalPrice),
    );
    const storesCount = new Set(mergedOffers.map(merchantKey)).size;
    const meaningful = mergedOffers
      .map((offer) => offer.dealScore)
      .filter((score) => score > 0);

    const dbProduct = await prisma.product.upsert({
      where: { externalId: product.externalId },
      create: {
        externalId: product.externalId,
        sourceProductId: product.sourceProductId,
        gid: product.gid,
        dataDocId: product.dataDocId,
        title: product.title,
        normalizedTitle: normalize(product.title),
        brand: product.brand,
        category: product.category,
        image:
          product.image ||
          mergedOffers.find((offer) => Boolean(offer.image))?.image,
        currency: product.currency,
        currentBestPrice: bestPrice,
        dealScore: meaningful.length ? Math.max(...meaningful) : 0,
        source: 'merchant-engine',
        lastSyncedAt: new Date(),
        lastEnrichedAt: new Date(),
      },
      update: {
        sourceProductId:
          product.sourceProductId ||
          existing?.sourceProductId ||
          undefined,
        gid: product.gid || existing?.gid || undefined,
        dataDocId:
          product.dataDocId ||
          existing?.dataDocId ||
          undefined,
        title: product.title,
        normalizedTitle: normalize(product.title),
        brand: product.brand || existing?.brand || undefined,
        category: product.category || existing?.category || undefined,
        image:
          product.image ||
          existing?.image ||
          mergedOffers.find((offer) => Boolean(offer.image))?.image ||
          undefined,
        currency: product.currency || existing?.currency || 'EUR',
        currentBestPrice: bestPrice,
        dealScore: meaningful.length ? Math.max(...meaningful) : 0,
        source: 'merchant-engine',
        lastSyncedAt: new Date(),
        lastEnrichedAt: new Date(),
      },
    });

    await prisma.offer.deleteMany({
      where: { productId: dbProduct.id },
    });

    await prisma.offer.createMany({
      data: mergedOffers.map((offer) => ({
        productId: dbProduct.id,
        merchant: offer.merchant,
        merchantDomain: offer.merchantDomain,
        variantLabel: offer.variantLabel,
        variantData: offer.variantData
          ? JSON.parse(JSON.stringify(offer.variantData))
          : undefined,
        image: offer.image,
        price: offer.price,
        shipping: offer.shipping,
        shippingKnown: Boolean(offer.shippingKnown),
        totalPrice: offer.totalPrice,
        currency: offer.currency,
        sellerRating: offer.sellerRating,
        sellerVotes: offer.sellerVotes,
        deliveryMessage: offer.deliveryMessage,
        rawUrl: offer.url,
        dealScore: offer.dealScore,
        isCheapest: offer.isCheapest,
        isBestOverall: offer.isBestOverall,
      })),
    });

    if (
      existing?.currentBestPrice == null ||
      Math.abs(existing.currentBestPrice - bestPrice) > 0.001
    ) {
      await prisma.priceSnapshot.create({
        data: {
          productId: dbProduct.id,
          price: bestPrice,
          currency: product.currency || 'EUR',
        },
      });
    }

    const dbOffers = await prisma.offer.findMany({
      where: { productId: dbProduct.id },
      orderBy: [
        { isBestOverall: 'desc' },
        { totalPrice: 'asc' },
      ],
    });

    saved.push({
      ...product,
      id: dbProduct.id,
      externalId: dbProduct.externalId,
      title: dbProduct.title,
      normalizedTitle: dbProduct.normalizedTitle,
      image: dbProduct.image || undefined,
      bestPrice,
      dealScore: meaningful.length ? Math.max(...meaningful) : 0,
      offers: dbOffers.map(dbOfferToView),
      storesCount,
      variants: Array.from(
        new Set(
          dbOffers
            .map((offer) => offer.variantLabel)
            .filter(Boolean) as string[],
        ),
      ),
      variantOptions: buildVariantOptions(dbOffers.map(dbOfferToView)),
    });
  }

  return saved;
}

function queryTokens(query: string) {
  return normalize(familyQuery(query))
    .split(' ')
    .filter((token) => token.length >= 2);
}

function productMatchesQuery(title: string, query: string) {
  const tokens = queryTokens(query);
  const haystack = normalize(title);

  if (!tokens.length) return true;

  return tokens.every((token) => haystack.includes(token));
}

export async function searchMarketCatalog(query: string) {
  const tokens = queryTokens(query);

  const products = await prisma.product.findMany({
    where: {
      source: 'merchant-engine',
      offers: { some: {} },
      ...(tokens.length
        ? {
            AND: tokens.slice(0, 6).map((token) => ({
              normalizedTitle: {
                contains: token,
                mode: 'insensitive' as const,
              },
            })),
          }
        : {}),
    },
    include: {
      offers: {
        orderBy: [
          { isBestOverall: 'desc' },
          { totalPrice: 'asc' },
        ],
      },
    },
    orderBy: [
      { dealScore: 'desc' },
      { currentBestPrice: 'asc' },
    ],
    take: 12,
  });

  return products
    .filter((product) => productMatchesQuery(product.title, query))
    .map((product) => {
      const offers = product.offers.map(dbOfferToView);
      const storesCount = new Set(offers.map(merchantKey)).size;

      return {
        id: product.id,
        externalId: product.externalId,
        sourceProductId: product.sourceProductId || undefined,
        gid: product.gid || undefined,
        dataDocId: product.dataDocId || undefined,
        title: product.title,
        normalizedTitle: product.normalizedTitle,
        brand: product.brand || undefined,
        category: product.category || undefined,
        image: product.image || undefined,
        bestPrice:
          product.currentBestPrice ||
          Math.min(...offers.map((offer) => offer.totalPrice)),
        currency: product.currency,
        dealScore: product.dealScore,
        offers,
        storesCount,
        variants: Array.from(
          new Set(
            offers
              .map((offer) => offer.variantLabel)
              .filter(Boolean) as string[],
          ),
        ),
        variantOptions: buildVariantOptions(offers),
      } satisfies ProductResult;
    });
}


export function normalizeLiveProducts(
  products: ProductResult[],
  expectedQuery: string,
) {
  const normalized: ProductResult[] = [];

  for (const product of products) {
    if (relevance(product.title, expectedQuery) < 0.55) continue;

    const offers = product.offers.filter((offer) => {
      const domain =
        safeDomain(offer.merchantDomain) ||
        safeDomain(offer.url);

      return merchantAllowed(domain, offer.merchant);
    });

    if (!offers.length) continue;

    const scored = scoreOffers(offers);
    const title = stableFamilyTitle(product.title);
    const externalId = familyExternalId(title);
    const storesCount = new Set(scored.map(merchantKey)).size;
    const meaningful = scored
      .map((offer) => offer.dealScore)
      .filter((score) => score > 0);

    normalized.push({
      ...product,
      id: externalId,
      externalId,
      title,
      normalizedTitle: normalize(title),
      brand: inferBrand(title) || product.brand,
      image:
        product.image ||
        scored.find((offer) => Boolean(offer.image))?.image,
      bestPrice: Math.min(...scored.map((offer) => offer.totalPrice)),
      dealScore: meaningful.length ? Math.max(...meaningful) : 0,
      offers: scored,
      storesCount,
      variants: Array.from(
        new Set(
          scored
            .map((offer) => offer.variantLabel)
            .filter(Boolean) as string[],
        ),
      ),
      variantOptions: buildVariantOptions(scored),
    });
  }

  return normalized.sort(
    (a, b) =>
      (b.storesCount || 0) -
        (a.storesCount || 0) ||
      a.bestPrice - b.bestPrice,
  );
}

export function bestIdentity(products: ProductResult[]) {
  const candidates = products
    .filter(
      (product) =>
        product.sourceProductId ||
        product.gid ||
        product.dataDocId,
    )
    .sort(
      (a, b) =>
        (b.storesCount || 0) -
        (a.storesCount || 0),
    );

  const best = candidates[0];

  if (!best) return null;

  return {
    productId: best.sourceProductId,
    gid: best.gid,
    dataDocId: best.dataDocId,
  };
}
