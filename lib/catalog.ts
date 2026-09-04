import { createHash } from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import { prisma } from '@/lib/db';
import {
  canonicalizeProductTitle,
  extractVariantData,
} from '@/lib/dataforseo';
import type {
  ProductResult,
  VariantAttributes,
} from '@/lib/types';

type FeedMapping = {
  itemPath?: string;
  delimiter?: string;
  fields?: Partial<
    Record<
      | 'externalId'
      | 'title'
      | 'brand'
      | 'model'
      | 'category'
      | 'gtin'
      | 'mpn'
      | 'sku'
      | 'price'
      | 'oldPrice'
      | 'currency'
      | 'url'
      | 'image'
      | 'availability'
      | 'stockQty'
      | 'shippingPrice'
      | 'deliveryDaysMin'
      | 'deliveryDaysMax'
      | 'color'
      | 'storage'
      | 'ram'
      | 'connectivity'
      | 'size'
      | 'condition',
      string
    >
  >;
};

type IncomingItem = {
  externalId?: string;
  title: string;
  brand?: string;
  model?: string;
  category?: string;
  gtin?: string;
  mpn?: string;
  sku?: string;
  price: number;
  oldPrice?: number;
  currency: string;
  url: string;
  image?: string;
  availability?: string;
  stockQty?: number;
  shippingPrice?: number;
  deliveryDaysMin?: number;
  deliveryDaysMax?: number;
  condition: string;
  variantData: VariantAttributes;
  canonicalFamilyKey: string;
  familyTitle: string;
  variantKey: string;
};

type SourceWithMerchant = {
  id: string;
  slug: string;
  name: string;
  url: string;
  format: string;
  mapping: unknown;
  authHeaderEnv: string | null;
  active: boolean;
  merchant: {
    id: string;
    slug: string;
    name: string;
    domain: string | null;
    trustScore: number | null;
    active: boolean;
  };
};

const RECURRING_PRICE_PATTERN =
  /(?:\/\s*mēn|mēnesī|mēneš|\/\s*mo\b|per\s+month|monthly|month\b|nomaks|līzing|leasing|installment|instalment|abonē|subscription|pirm[aā]\s+iemaksa|first\s+payment|down\s+payment|deposit|tarifs?|plan\s+from|\b\d+\s*[x×]\s*€|\b\d+\s*mēn)/i;

const USED_PATTERN =
  /\b(used|refurbished|renewed|reconditioned|open[\s-]?box|demo|lietots|lietota|atjaunots|atjaunota|mazlietots|vitrīnas)\b/i;

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9āčēģīķļņōŗšūž]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value: string) {
  return normalizeText(value).replace(/\s+/g, '-');
}

function hash(value: string) {
  return createHash('sha1').update(value).digest('hex');
}

function stringValue(value: unknown) {
  if (value == null) return undefined;
  const result = String(value).trim();
  return result || undefined;
}

function numberValue(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (value == null) return undefined;

  const raw = String(value)
    .replace(/\s/g, '')
    .replace(/[^\d,.-]/g, '');

  if (!raw) return undefined;

  let normalized = raw;

  if (raw.includes(',') && raw.includes('.')) {
    if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) {
      normalized = raw.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = raw.replace(/,/g, '');
    }
  } else if (raw.includes(',')) {
    normalized = raw.replace(',', '.');
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function intValue(value: unknown) {
  const number = numberValue(value);
  return number == null ? undefined : Math.round(number);
}

function readPath(value: any, path?: string): unknown {
  if (!path) return undefined;

  const parts = path
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);

  let current = value;

  for (const part of parts) {
    if (current == null) return undefined;

    if (Array.isArray(current)) {
      const index = Number(part);
      if (Number.isInteger(index)) {
        current = current[index];
      } else {
        return undefined;
      }
    } else {
      current = current[part];
    }
  }

  return current;
}

function firstValue(
  raw: any,
  mapping: FeedMapping,
  field: keyof NonNullable<FeedMapping['fields']>,
  fallbacks: string[],
) {
  const mappedPath = mapping.fields?.[field];

  if (mappedPath) {
    const mapped = readPath(raw, mappedPath);
    if (mapped != null && mapped !== '') return mapped;
  }

  for (const path of fallbacks) {
    const value = readPath(raw, path);
    if (value != null && value !== '') return value;
  }

  return undefined;
}

function findItemsByPath(root: any, path?: string): any[] {
  if (!path) {
    if (Array.isArray(root)) return root;

    if (root && typeof root === 'object') {
      const candidates = [
        root.products,
        root.items,
        root.product,
        root.offers,
        root.feed?.products,
        root.catalog?.products,
      ];

      for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate;
        if (candidate && typeof candidate === 'object') {
          return [candidate];
        }
      }
    }

    return [];
  }

  const value = readPath(root, path);

  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];

  return [];
}

function detectCsvDelimiter(header: string, configured?: string) {
  if (configured) return configured;
  const options = [',', ';', '\t', '|'];
  return options.sort(
    (a, b) =>
      header.split(b).length - header.split(a).length,
  )[0];
}

function splitCsvLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === delimiter && !quoted) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseCsv(body: string, mapping: FeedMapping) {
  const lines = body
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length);

  if (lines.length < 2) return [];

  const delimiter = detectCsvDelimiter(
    lines[0],
    mapping.delimiter,
  );

  const headers = splitCsvLine(lines[0], delimiter).map(
    (header) => header.trim(),
  );

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line, delimiter);
    return Object.fromEntries(
      headers.map((header, index) => [
        header,
        values[index]?.trim() ?? '',
      ]),
    );
  });
}

function parseBody(
  body: string,
  format: string,
  mapping: FeedMapping,
) {
  const normalized = format.toLowerCase();

  if (normalized === 'json') {
    const parsed = JSON.parse(body);
    return findItemsByPath(parsed, mapping.itemPath);
  }

  if (normalized === 'csv') {
    return parseCsv(body, mapping);
  }

  if (normalized === 'xml') {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseTagValue: false,
      trimValues: true,
    });

    const parsed = parser.parse(body);
    return findItemsByPath(parsed, mapping.itemPath);
  }

  throw new Error(
    `Unsupported feed format: ${format}. Use xml, csv or json.`,
  );
}

function normalizeCondition(
  explicit: unknown,
  title: string,
) {
  const value = stringValue(explicit);

  if (value) {
    if (
      /new|jaun/i.test(value) &&
      !USED_PATTERN.test(value)
    ) {
      return 'New';
    }

    return value;
  }

  return USED_PATTERN.test(title)
    ? 'Refurbished / Used'
    : 'New';
}

function cleanBrand(value?: string) {
  if (!value) return undefined;
  return value
    .replace(/\s+/g, ' ')
    .trim();
}

function inferBrand(
  title: string,
  explicit?: string,
) {
  if (explicit) return cleanBrand(explicit);

  if (/\biphone\b|\bipad\b|\bmacbook\b|\bairpods\b/i.test(title)) {
    return 'Apple';
  }

  if (/\bgalaxy\b/i.test(title)) return 'Samsung';
  if (/\bpixel\b/i.test(title)) return 'Google';

  const first = title.split(/\s+/)[0];
  return first?.length > 1 ? first : undefined;
}

function familyTitleFor(
  title: string,
  brand?: string,
  model?: string,
) {
  if (brand && model) {
    return `${brand} ${model}`
      .replace(/\s+/g, ' ')
      .trim();
  }

  const canonical =
    canonicalizeProductTitle(title) || title;

  if (
    brand &&
    !canonical
      .toLowerCase()
      .startsWith(brand.toLowerCase())
  ) {
    return `${brand} ${canonical}`.trim();
  }

  return canonical;
}

function canonicalFamilyKeyFor(
  familyTitle: string,
  brand?: string,
  model?: string,
) {
  if (brand && model) {
    return normalizeText(`${brand} ${model}`);
  }

  return normalizeText(familyTitle);
}

function variantLabel(data: VariantAttributes) {
  return [
    data.storage,
    data.ram ? `${data.ram} RAM` : undefined,
    data.color,
    data.connectivity,
    data.size,
    data.condition &&
    data.condition !== 'New'
      ? data.condition
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

function normalizeIncoming(
  raw: any,
  mapping: FeedMapping,
): IncomingItem | null {
  const title = stringValue(
    firstValue(raw, mapping, 'title', [
      'title',
      'name',
      'product_name',
      'productName',
      'description.name',
    ]),
  );

  const url = stringValue(
    firstValue(raw, mapping, 'url', [
      'url',
      'link',
      'product_url',
      'productUrl',
    ]),
  );

  const priceRaw = firstValue(
    raw,
    mapping,
    'price',
    [
      'price',
      'current_price',
      'currentPrice',
      'sale_price',
      'salePrice',
    ],
  );

  const price = numberValue(priceRaw);

  if (!title || !url || !price || price <= 0) {
    return null;
  }

  const combined = [
    title,
    stringValue(priceRaw),
    stringValue(
      firstValue(raw, mapping, 'availability', [
        'availability',
        'stock_status',
        'stockStatus',
      ]),
    ),
  ]
    .filter(Boolean)
    .join(' ');

  if (RECURRING_PRICE_PATTERN.test(combined)) {
    return null;
  }

  const explicitBrand = stringValue(
    firstValue(raw, mapping, 'brand', [
      'brand',
      'manufacturer',
      'vendor',
      'maker',
    ]),
  );

  const brand = inferBrand(title, explicitBrand);

  const model = stringValue(
    firstValue(raw, mapping, 'model', [
      'model',
      'model_name',
      'modelName',
    ]),
  );

  const category = stringValue(
    firstValue(raw, mapping, 'category', [
      'category',
      'category_name',
      'categoryName',
      'product_type',
    ]),
  );

  const gtin = stringValue(
    firstValue(raw, mapping, 'gtin', [
      'gtin',
      'ean',
      'ean13',
      'barcode',
    ]),
  )?.replace(/\D/g, '');

  const mpn = stringValue(
    firstValue(raw, mapping, 'mpn', [
      'mpn',
      'manufacturer_part_number',
      'manufacturerPartNumber',
    ]),
  );

  const sku = stringValue(
    firstValue(raw, mapping, 'sku', [
      'sku',
      'article',
      'article_number',
      'product_code',
      'productCode',
    ]),
  );

  const condition = normalizeCondition(
    firstValue(raw, mapping, 'condition', [
      'condition',
      'state',
    ]),
    title,
  );

  const extracted =
    extractVariantData(title);

  const variantData: VariantAttributes = {
    storage:
      stringValue(
        firstValue(raw, mapping, 'storage', [
          'storage',
          'memory',
          'capacity',
        ]),
      ) || extracted.storage,
    ram:
      stringValue(
        firstValue(raw, mapping, 'ram', [
          'ram',
          'memory_ram',
        ]),
      ) || extracted.ram,
    color:
      stringValue(
        firstValue(raw, mapping, 'color', [
          'color',
          'colour',
        ]),
      ) || extracted.color,
    connectivity:
      stringValue(
        firstValue(raw, mapping, 'connectivity', [
          'connectivity',
          'network',
        ]),
      ) || extracted.connectivity,
    size:
      stringValue(
        firstValue(raw, mapping, 'size', [
          'size',
          'screen_size',
          'screenSize',
        ]),
      ) || extracted.size,
    condition,
  };

  const familyTitle =
    familyTitleFor(
      title,
      brand,
      model,
    );

  const canonicalFamilyKey =
    canonicalFamilyKeyFor(
      familyTitle,
      brand,
      model,
    );

  const attrKey = Object.entries(variantData)
    .filter(([, value]) => Boolean(value))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${normalizeText(String(value))}`)
    .join('|');

  const variantKey = gtin
    ? `gtin:${gtin}`
    : mpn
      ? `mpn:${normalizeText(mpn)}`
      : `attrs:${hash(
          `${canonicalFamilyKey}|${attrKey || normalizeText(title)}`,
        )}`;

  return {
    externalId: stringValue(
      firstValue(raw, mapping, 'externalId', [
        'id',
        'product_id',
        'productId',
        'offer_id',
        'offerId',
        'sku',
      ]),
    ),
    title,
    brand,
    model,
    category,
    gtin,
    mpn,
    sku,
    price,
    oldPrice: numberValue(
      firstValue(raw, mapping, 'oldPrice', [
        'old_price',
        'oldPrice',
        'regular_price',
        'regularPrice',
      ]),
    ),
    currency:
      stringValue(
        firstValue(raw, mapping, 'currency', [
          'currency',
          'currency_code',
          'currencyCode',
        ]),
      )?.toUpperCase() || 'EUR',
    url,
    image: stringValue(
      firstValue(raw, mapping, 'image', [
        'image',
        'image_url',
        'imageUrl',
        'picture',
        'photo',
      ]),
    ),
    availability: stringValue(
      firstValue(raw, mapping, 'availability', [
        'availability',
        'stock_status',
        'stockStatus',
      ]),
    ),
    stockQty: intValue(
      firstValue(raw, mapping, 'stockQty', [
        'stock',
        'stock_qty',
        'stockQty',
        'quantity',
      ]),
    ),
    shippingPrice: numberValue(
      firstValue(raw, mapping, 'shippingPrice', [
        'shipping_price',
        'shippingPrice',
        'delivery_price',
        'deliveryPrice',
      ]),
    ),
    deliveryDaysMin: intValue(
      firstValue(raw, mapping, 'deliveryDaysMin', [
        'delivery_days_min',
        'deliveryDaysMin',
      ]),
    ),
    deliveryDaysMax: intValue(
      firstValue(raw, mapping, 'deliveryDaysMax', [
        'delivery_days_max',
        'deliveryDaysMax',
        'delivery_days',
      ]),
    ),
    condition,
    variantData,
    canonicalFamilyKey,
    familyTitle,
    variantKey,
  };
}

function median(values: number[]) {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rejectExtremeOutliers(items: IncomingItem[]) {
  const groups = new Map<string, IncomingItem[]>();

  for (const item of items) {
    groups.set(item.canonicalFamilyKey, [
      ...(groups.get(item.canonicalFamilyKey) || []),
      item,
    ]);
  }

  const accepted: IncomingItem[] = [];
  let rejected = 0;

  for (const group of groups.values()) {
    if (group.length < 3) {
      accepted.push(...group);
      continue;
    }

    const prices = group.map((item) => item.price);
    const med = median(prices);

    for (const item of group) {
      if (
        med >= 100 &&
        item.price < med * 0.35
      ) {
        rejected += 1;
      } else {
        accepted.push(item);
      }
    }
  }

  return { accepted, rejected };
}

function offerKeyFor(
  sourceId: string,
  merchantId: string,
  item: IncomingItem,
) {
  const stable =
    item.externalId ||
    item.sku ||
    item.url ||
    `${item.variantKey}|${item.title}`;

  return hash(
    `${sourceId}|${merchantId}|${stable}`,
  );
}

async function fetchFeed(
  source: SourceWithMerchant,
) {
  const headers: Record<string, string> = {
    Accept:
      'application/xml,text/xml,application/json,text/csv,text/plain,*/*',
    'User-Agent':
      'CENIQ/3.0 catalog importer',
  };

  if (source.authHeaderEnv) {
    const secret =
      process.env[source.authHeaderEnv];

    if (!secret) {
      throw new Error(
        `Missing environment variable ${source.authHeaderEnv}.`,
      );
    }

    headers.Authorization = secret;
  }

  const response = await fetch(source.url, {
    headers,
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(
      `Feed request failed (${response.status}) for ${source.slug}.`,
    );
  }

  return response.text();
}

type ScorableCatalogOffer = {
  id: string;
  merchantId: string;
  title: string;
  url: string;
  image: string | null;
  price: number;
  currency: string;
  shippingPrice: number | null;
  deliveryDaysMin: number | null;
  deliveryDaysMax: number | null;
  availability: string | null;
  merchant: {
    name: string;
    domain: string | null;
    trustScore: number | null;
  };
};

function scoreVariantOffers(
  offers: ScorableCatalogOffer[],
) {
  const merchants = new Set(
    offers.map((offer) => offer.merchantId),
  );

  const sortedPrices = offers
    .map((offer) => offer.price)
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);

  const middle = Math.floor(sortedPrices.length / 2);
  const marketReference = sortedPrices.length % 2
    ? sortedPrices[middle]
    : (sortedPrices[middle - 1] + sortedPrices[middle]) / 2;

  const min = sortedPrices[0] || 0;

  const scored = offers.map((offer) => {
    if (merchants.size < 2 || !marketReference) {
      return {
        offer,
        dealScore: 0,
        isCheapest: false,
        isBestOverall: false,
      };
    }

    const relativeValue =
      (marketReference - offer.price) / marketReference;

    let score =
      80 + relativeValue * 180;

    const trust =
      offer.merchant.trustScore;

    if (trust != null) {
      score += Math.max(
        -3,
        Math.min(3, (trust - 4) * 3),
      );
    }

    if (merchants.size >= 3) score += 1;
    if (merchants.size >= 5) score += 1;

    score = Math.round(
      Math.max(55, Math.min(95, score)),
    );

    return {
      offer,
      dealScore: score,
      isCheapest:
        Math.abs(offer.price - min) < 0.001,
      isBestOverall: false,
    };
  });

  if (scored.length) {
    let bestIndex = 0;

    scored.forEach((item, index) => {
      if (item.dealScore > scored[bestIndex].dealScore) {
        bestIndex = index;
      }
    });

    if (scored[bestIndex].dealScore > 0) {
      scored[bestIndex].isBestOverall = true;
    }
  }

  return scored;
}

export async function projectFamilyToLegacy(
  familyId: string,
) {
  const family =
    await prisma.catalogFamily.findUnique({
      where: { id: familyId },
      include: {
        variants: {
          where: { active: true },
          include: {
            offers: {
              where: { active: true },
              include: {
                merchant: true,
              },
              orderBy: {
                price: 'asc',
              },
            },
          },
        },
      },
    });

  if (!family) return null;

  const projectedOffers: Array<{
    merchant: string;
    merchantDomain?: string;
    variantLabel?: string;
    variantData?: VariantAttributes;
    image?: string;
    price: number;
    shipping: number;
    shippingKnown: boolean;
    totalPrice: number;
    currency: string;
    dealScore: number;
    sellerRating?: number;
    deliveryMessage?: string;
    url: string;
    isCheapest: boolean;
    isBestOverall: boolean;
  }> = [];

  for (const variant of family.variants) {
    if (!variant.offers.length) continue;

    const scored =
      scoreVariantOffers(variant.offers);

    if (scored.length) {
      let best = 0;

      scored.forEach((item, index) => {
        if (
          item.dealScore >
          scored[best].dealScore
        ) {
          best = index;
        }
      });

      if (scored[best].dealScore > 0) {
        scored[best].isBestOverall = true;
      }
    }

    const data: VariantAttributes = {
      color: variant.color || undefined,
      storage: variant.storage || undefined,
      ram: variant.ram || undefined,
      connectivity:
        variant.connectivity || undefined,
      size: variant.size || undefined,
      condition:
        variant.condition || undefined,
    };

    for (const item of scored) {
      const offer = item.offer;

      const deliveryMessage =
        offer.availability ||
        (offer.deliveryDaysMax
          ? `Piegāde līdz ${offer.deliveryDaysMax} dienām`
          : offer.deliveryDaysMin
            ? `Piegāde no ${offer.deliveryDaysMin} dienām`
            : undefined);

      const shippingKnown =
        offer.shippingPrice != null;

      projectedOffers.push({
        merchant: offer.merchant.name,
        merchantDomain:
          offer.merchant.domain || undefined,
        variantLabel:
          variantLabel(data) || undefined,
        variantData: data,
        image:
          offer.image ||
          variant.image ||
          family.image ||
          undefined,
        price: offer.price,
        shipping:
          offer.shippingPrice || 0,
        shippingKnown,
        totalPrice:
          offer.price +
          (offer.shippingPrice || 0),
        currency: offer.currency,
        dealScore: item.dealScore,
        sellerRating:
          offer.merchant.trustScore ||
          undefined,
        deliveryMessage,
        url: offer.url,
        isCheapest: item.isCheapest,
        isBestOverall:
          item.isBestOverall,
      });
    }
  }

  const activeOffers =
    projectedOffers.filter(
      (offer) => offer.price > 0,
    );

  if (!activeOffers.length) {
    const existing =
      await prisma.product.findUnique({
        where: {
          externalId:
            `catalog:${family.id}`,
        },
      });

    if (existing) {
      await prisma.offer.deleteMany({
        where: {
          productId: existing.id,
        },
      });

      await prisma.product.update({
        where: { id: existing.id },
        data: {
          currentBestPrice: null,
          dealScore: 0,
          lastSyncedAt: new Date(),
        },
      });
    }

    return existing;
  }

  const bestPrice = Math.min(
    ...activeOffers.map(
      (offer) => offer.totalPrice,
    ),
  );

  const bestScore = Math.max(
    0,
    ...activeOffers.map(
      (offer) => offer.dealScore,
    ),
  );

  const existing =
    await prisma.product.findUnique({
      where: {
        externalId:
          `catalog:${family.id}`,
      },
      select: {
        id: true,
        currentBestPrice: true,
      },
    });

  const legacyProduct =
    await prisma.product.upsert({
      where: {
        externalId:
          `catalog:${family.id}`,
      },
      create: {
        externalId:
          `catalog:${family.id}`,
        title: family.title,
        normalizedTitle:
          family.normalizedTitle,
        brand: family.brand,
        category: family.category,
        image:
          family.image ||
          activeOffers.find(
            (offer) =>
              Boolean(offer.image),
          )?.image,
        currency:
          activeOffers[0]?.currency ||
          'EUR',
        currentBestPrice: bestPrice,
        dealScore: bestScore,
        source: 'catalog',
        lastSyncedAt: new Date(),
        lastEnrichedAt: new Date(),
      },
      update: {
        title: family.title,
        normalizedTitle:
          family.normalizedTitle,
        brand: family.brand,
        category: family.category,
        image:
          family.image ||
          activeOffers.find(
            (offer) =>
              Boolean(offer.image),
          )?.image ||
          undefined,
        currency:
          activeOffers[0]?.currency ||
          'EUR',
        currentBestPrice: bestPrice,
        dealScore: bestScore,
        source: 'catalog',
        lastSyncedAt: new Date(),
        lastEnrichedAt: new Date(),
      },
    });

  await prisma.offer.deleteMany({
    where: {
      productId:
        legacyProduct.id,
    },
  });

  await prisma.offer.createMany({
    data: activeOffers.map(
      (offer) => ({
        productId:
          legacyProduct.id,
        merchant: offer.merchant,
        merchantDomain:
          offer.merchantDomain,
        variantLabel:
          offer.variantLabel,
        variantData:
          offer.variantData
            ? JSON.parse(
                JSON.stringify(
                  offer.variantData,
                ),
              )
            : undefined,
        image: offer.image,
        price: offer.price,
        shipping:
          offer.shipping,
        shippingKnown:
          offer.shippingKnown,
        totalPrice:
          offer.totalPrice,
        currency:
          offer.currency,
        sellerRating:
          offer.sellerRating,
        deliveryMessage:
          offer.deliveryMessage,
        rawUrl: offer.url,
        dealScore:
          offer.dealScore,
        isCheapest:
          offer.isCheapest,
        isBestOverall:
          offer.isBestOverall,
      }),
    ),
  });

  if (
    existing?.currentBestPrice == null ||
    Math.abs(
      existing.currentBestPrice -
        bestPrice,
    ) > 0.001
  ) {
    await prisma.priceSnapshot.create({
      data: {
        productId:
          legacyProduct.id,
        price: bestPrice,
        currency:
          activeOffers[0]?.currency ||
          'EUR',
      },
    });
  }

  return legacyProduct;
}

async function upsertIncomingItem(
  source: SourceWithMerchant,
  item: IncomingItem,
) {
  if (!source.merchant) {
    throw new Error(
      'Feed source has no merchant.',
    );
  }

  const family =
    await prisma.catalogFamily.upsert({
      where: {
        canonicalKey:
          item.canonicalFamilyKey,
      },
      create: {
        canonicalKey:
          item.canonicalFamilyKey,
        title: item.familyTitle,
        normalizedTitle:
          normalizeText(
            item.familyTitle,
          ),
        brand: item.brand,
        model: item.model,
        category:
          item.category,
        image: item.image,
      },
      update: {
        title: item.familyTitle,
        normalizedTitle:
          normalizeText(
            item.familyTitle,
          ),
        brand:
          item.brand || undefined,
        model:
          item.model || undefined,
        category:
          item.category || undefined,
        image:
          item.image || undefined,
        active: true,
      },
    });

  const variant =
    await prisma.catalogVariant.upsert({
      where: {
        familyId_variantKey: {
          familyId: family.id,
          variantKey:
            item.variantKey,
        },
      },
      create: {
        familyId: family.id,
        variantKey:
          item.variantKey,
        gtin: item.gtin,
        mpn: item.mpn,
        color:
          item.variantData.color,
        storage:
          item.variantData.storage,
        ram: item.variantData.ram,
        connectivity:
          item.variantData.connectivity,
        size: item.variantData.size,
        condition:
          item.condition,
        attributes: JSON.parse(
          JSON.stringify(
            item.variantData,
          ),
        ),
        image: item.image,
      },
      update: {
        gtin:
          item.gtin || undefined,
        mpn:
          item.mpn || undefined,
        color:
          item.variantData.color ||
          undefined,
        storage:
          item.variantData.storage ||
          undefined,
        ram:
          item.variantData.ram ||
          undefined,
        connectivity:
          item.variantData.connectivity ||
          undefined,
        size:
          item.variantData.size ||
          undefined,
        condition:
          item.condition,
        attributes: JSON.parse(
          JSON.stringify(
            item.variantData,
          ),
        ),
        image:
          item.image || undefined,
        active: true,
      },
    });

  const offerKey = offerKeyFor(
    source.id,
    source.merchant.id,
    item,
  );

  const existing =
    await prisma.catalogOffer.findUnique({
      where: { offerKey },
      select: {
        id: true,
        price: true,
        shippingPrice: true,
        availability: true,
        stockQty: true,
      },
    });

  const offer =
    await prisma.catalogOffer.upsert({
      where: { offerKey },
      create: {
        offerKey,
        sourceId: source.id,
        merchantId:
          source.merchant.id,
        variantId: variant.id,
        externalId:
          item.externalId,
        title: item.title,
        url: item.url,
        image: item.image,
        price: item.price,
        oldPrice:
          item.oldPrice,
        currency:
          item.currency,
        shippingPrice:
          item.shippingPrice,
        deliveryDaysMin:
          item.deliveryDaysMin,
        deliveryDaysMax:
          item.deliveryDaysMax,
        availability:
          item.availability,
        stockQty:
          item.stockQty,
        condition:
          item.condition,
        active: true,
        lastSeenAt:
          new Date(),
      },
      update: {
        variantId: variant.id,
        externalId:
          item.externalId ||
          undefined,
        title: item.title,
        url: item.url,
        image:
          item.image ||
          undefined,
        price: item.price,
        oldPrice:
          item.oldPrice,
        currency:
          item.currency,
        shippingPrice:
          item.shippingPrice,
        deliveryDaysMin:
          item.deliveryDaysMin,
        deliveryDaysMax:
          item.deliveryDaysMax,
        availability:
          item.availability,
        stockQty:
          item.stockQty,
        condition:
          item.condition,
        active: true,
        lastSeenAt:
          new Date(),
      },
    });

  const changed =
    !existing ||
    Math.abs(
      existing.price -
        item.price,
    ) > 0.001 ||
    existing.shippingPrice !==
      item.shippingPrice ||
    existing.availability !==
      item.availability ||
    existing.stockQty !==
      item.stockQty;

  if (changed) {
    await prisma.catalogPriceSnapshot.create({
      data: {
        offerId: offer.id,
        price: item.price,
        shippingPrice:
          item.shippingPrice,
        availability:
          item.availability,
        stockQty:
          item.stockQty,
      },
    });
  }

  return {
    familyId: family.id,
    offerKey,
  };
}

export async function importFeedSource(
  sourceId: string,
) {
  const source =
    await prisma.feedSource.findUnique({
      where: { id: sourceId },
      include: {
        merchant: true,
      },
    });

  if (
    !source ||
    !source.active ||
    !source.merchant.active
  ) {
    throw new Error(
      'Feed source is missing or inactive.',
    );
  }

  const run =
    await prisma.importRun.create({
      data: {
        sourceId: source.id,
      },
    });

  try {
    const body =
      await fetchFeed(source);

    const mapping =
      (source.mapping || {}) as FeedMapping;

    const rawItems = parseBody(
      body,
      source.format,
      mapping,
    );

    const normalized =
      rawItems
        .map((raw) =>
          normalizeIncoming(
            raw,
            mapping,
          ),
        )
        .filter(
          Boolean,
        ) as IncomingItem[];

    const basicRejected =
      rawItems.length -
      normalized.length;

    const filtered =
      rejectExtremeOutliers(
        normalized,
      );

    const seenKeys: string[] = [];
    const touchedFamilies =
      new Set<string>();

    for (const item of filtered.accepted) {
      const result =
        await upsertIncomingItem(
          source,
          item,
        );

      seenKeys.push(
        result.offerKey,
      );

      touchedFamilies.add(
        result.familyId,
      );
    }

    if (seenKeys.length) {
      await prisma.catalogOffer.updateMany({
        where: {
          sourceId: source.id,
          offerKey: {
            notIn: seenKeys,
          },
        },
        data: {
          active: false,
        },
      });
    }

    await prisma.feedSource.update({
      where: { id: source.id },
      data: {
        lastImportedAt:
          new Date(),
      },
    });

    for (const familyId of touchedFamilies) {
      await projectFamilyToLegacy(
        familyId,
      );
    }

    const rejectedCount =
      basicRejected +
      filtered.rejected;

    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        status: 'success',
        itemCount:
          rawItems.length,
        acceptedCount:
          filtered.accepted.length,
        rejectedCount,
        finishedAt:
          new Date(),
      },
    });

    return {
      source: source.slug,
      merchant:
        source.merchant.name,
      itemCount:
        rawItems.length,
      acceptedCount:
        filtered.accepted.length,
      rejectedCount,
      familiesTouched:
        touchedFamilies.size,
    };
  } catch (error) {
    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        error:
          error instanceof Error
            ? error.message.slice(
                0,
                2000,
              )
            : 'Unknown import error',
        finishedAt:
          new Date(),
      },
    });

    throw error;
  }
}

function mapLegacyProduct(
  product: any,
): ProductResult {
  const offers = product.offers.map(
    (offer: any) => ({
      id: offer.id,
      merchant: offer.merchant,
      merchantDomain:
        offer.merchantDomain ||
        undefined,
      variantLabel:
        offer.variantLabel ||
        undefined,
      variantData:
        (offer.variantData as
          | VariantAttributes
          | null) ||
        undefined,
      image:
        offer.image || undefined,
      price: offer.price,
      shipping:
        offer.shipping,
      shippingKnown:
        offer.shippingKnown,
      totalPrice:
        offer.totalPrice,
      currency:
        offer.currency,
      sellerRating:
        offer.sellerRating ||
        undefined,
      sellerVotes:
        offer.sellerVotes ||
        undefined,
      deliveryMessage:
        offer.deliveryMessage ||
        undefined,
      url:
        offer.rawUrl ||
        undefined,
      dealScore:
        offer.dealScore,
      isCheapest:
        offer.isCheapest,
      isBestOverall:
        offer.isBestOverall,
    }),
  );

  return {
    id: product.id,
    externalId:
      product.externalId,
    title: product.title,
    normalizedTitle:
      product.normalizedTitle,
    brand:
      product.brand || undefined,
    category:
      product.category ||
      undefined,
    description:
      product.description ||
      undefined,
    image:
      product.image || undefined,
    bestPrice:
      product.currentBestPrice ||
      Math.min(
        ...offers.map(
          (offer: any) =>
            offer.totalPrice,
        ),
      ),
    currency:
      product.currency,
    dealScore:
      product.dealScore,
    offers,
    storesCount: new Set(
      offers.map(
        (offer: any) =>
          (
            offer.merchantDomain ||
            offer.merchant
          )
            .toLowerCase()
            .replace(/^www\./, ''),
      ),
    ).size,
    variants: Array.from(
      new Set(
        offers
          .map(
            (offer: any) =>
              offer.variantLabel,
          )
          .filter(
            Boolean,
          ) as string[],
      ),
    ),
  };
}

export async function searchCatalog(
  query: string,
): Promise<ProductResult[]> {
  const normalized =
    normalizeText(query);

  const tokens = normalized
    .split(' ')
    .filter(
      (token) =>
        token.length >= 2,
    )
    .slice(0, 6);

  const tokenAnd = tokens.map(
    (token) => ({
      OR: [
        {
          normalizedTitle: {
            contains: token,
            mode: 'insensitive' as const,
          },
        },
        {
          brand: {
            contains: token,
            mode: 'insensitive' as const,
          },
        },
        {
          category: {
            contains: token,
            mode: 'insensitive' as const,
          },
        },
      ],
    }),
  );

  const products =
    await prisma.product.findMany({
      where: {
        source: 'catalog',
        offers: {
          some: {},
        },
        OR: [
          {
            title: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            normalizedTitle: {
              contains:
                normalized,
              mode: 'insensitive',
            },
          },
          ...(tokenAnd.length
            ? [
                {
                  AND: tokenAnd,
                },
              ]
            : []),
        ],
      },
      include: {
        offers: {
          orderBy: [
            {
              isBestOverall:
                'desc',
            },
            {
              totalPrice: 'asc',
            },
          ],
        },
      },
      orderBy: [
        {
          dealScore: 'desc',
        },
        {
          currentBestPrice:
            'asc',
        },
      ],
      take: 30,
    });

  return products.map(
    mapLegacyProduct,
  );
}

export async function upsertFeedSource(input: {
  merchant: {
    slug?: string;
    name: string;
    domain?: string;
    trustScore?: number;
  };
  source: {
    slug?: string;
    name?: string;
    url: string;
    format: 'xml' | 'json' | 'csv';
    mapping?: FeedMapping;
    authHeaderEnv?: string;
  };
}) {
  const merchantSlug =
    input.merchant.slug ||
    slugify(
      input.merchant.name,
    );

  const merchant =
    await prisma.merchant.upsert({
      where: {
        slug: merchantSlug,
      },
      create: {
        slug: merchantSlug,
        name: input.merchant.name,
        domain:
          input.merchant.domain,
        trustScore:
          input.merchant.trustScore,
      },
      update: {
        name: input.merchant.name,
        domain:
          input.merchant.domain,
        trustScore:
          input.merchant.trustScore,
        active: true,
      },
    });

  const sourceSlug =
    input.source.slug ||
    `${merchantSlug}-feed`;

  return prisma.feedSource.upsert({
    where: {
      slug: sourceSlug,
    },
    create: {
      merchantId:
        merchant.id,
      slug: sourceSlug,
      name:
        input.source.name ||
        `${input.merchant.name} feed`,
      url: input.source.url,
      format:
        input.source.format,
      mapping:
        JSON.parse(
          JSON.stringify(
            input.source.mapping ||
              {},
          ),
        ),
      authHeaderEnv:
        input.source.authHeaderEnv,
    },
    update: {
      merchantId:
        merchant.id,
      name:
        input.source.name ||
        `${input.merchant.name} feed`,
      url: input.source.url,
      format:
        input.source.format,
      mapping:
        JSON.parse(
          JSON.stringify(
            input.source.mapping ||
              {},
          ),
        ),
      authHeaderEnv:
        input.source.authHeaderEnv,
      active: true,
    },
  });
}

export function verifyCatalogSecret(
  request: Request,
) {
  const secret =
    process.env.CRON_SECRET;

  if (!secret) return false;

  const auth =
    request.headers.get(
      'authorization',
    );

  const custom =
    request.headers.get(
      'x-ceniq-secret',
    );

  return (
    auth ===
      `Bearer ${secret}` ||
    custom === secret
  );
}
