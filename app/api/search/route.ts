import { NextResponse } from 'next/server';
import {
  canonicalizeProductTitle,
  mapFastProductSearch,
  searchProductsFast,
} from '@/lib/dataforseo';
import { persistProducts } from '@/lib/products';
import { getSessionUser } from '@/lib/auth';
import {
  databaseConfigured,
  prisma,
} from '@/lib/db';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import type {
  OfferView,
  ProductResult,
} from '@/lib/types';
import { searchCatalog } from '@/lib/catalog';
import {
  ALLOWED_MERCHANT_DOMAINS,
  LATVIA_ELECTRONICS_STORES,
  type StoreSeed,
} from '@/lib/store-registry';
import { enrichCatalogFromApprovedStores } from '@/lib/store-adapters';

export const maxDuration = 30;

const CACHE_MINUTES = Math.min(
  180,
  Math.max(
    5,
    Number(process.env.SEARCH_CACHE_MINUTES || 30),
  ),
);

function normalizeCacheKey(query: string) {
  return `v34:${query.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

const ALLOWED_MERCHANT_NAMES: string[] = Array.from(
  new Set(
    LATVIA_ELECTRONICS_STORES.flatMap((store: StoreSeed) => [
      store.name,
      store.slug,
      store.domain,
    ])
      .map((value: string) =>
        value
          .toLowerCase()
          .replace(/[^a-z0-9āčēģīķļņōŗšūž]+/gi, ''),
      )
      .filter(Boolean),
  ),
);

function normalizedDomain(value?: string) {
  if (!value) return '';

  try {
    return new URL(
      value.includes('://') ? value : `https://${value}`,
    ).hostname
      .replace(/^www\./i, '')
      .toLowerCase();
  } catch {
    return value
      .replace(/^www\./i, '')
      .toLowerCase()
      .split('/')[0];
  }
}

function isApprovedDomain(domain: string) {
  const normalized = normalizedDomain(domain);

  return ALLOWED_MERCHANT_DOMAINS.some(
    (allowed: string) =>
      normalized === allowed ||
      normalized.endsWith(`.${allowed}`) ||
      allowed.endsWith(`.${normalized}`),
  );
}

function offerDomain(offer: OfferView) {
  if (offer.merchantDomain) {
    return normalizedDomain(offer.merchantDomain);
  }

  if (offer.url) {
    return normalizedDomain(offer.url);
  }

  return '';
}

function filterApprovedMerchants(products: ProductResult[]) {
  const filtered: ProductResult[] = [];

  for (const product of products) {
    const offers = product.offers.filter((offer: OfferView) => {
      const domain = offerDomain(offer);

      if (domain) return isApprovedDomain(domain);

      const merchant = offer.merchant
        .toLowerCase()
        .replace(/[^a-z0-9āčēģīķļņōŗšūž]+/gi, '');

      return ALLOWED_MERCHANT_NAMES.some(
        (name: string) =>
          merchant === name ||
          merchant.startsWith(name) ||
          name.startsWith(merchant),
      );
    });

    if (!offers.length) continue;

    const bestPrice = Math.min(
      ...offers.map((offer: OfferView) => offer.totalPrice),
    );

    const storeCount = new Set(
      offers.map(
        (offer: OfferView) =>
          offerDomain(offer) || offer.merchant.toLowerCase(),
      ),
    ).size;

    const scores = offers
      .map((offer: OfferView) => offer.dealScore)
      .filter((score: number) => score > 0);

    filtered.push({
      ...product,
      offers,
      bestPrice,
      storesCount: storeCount,
      dealScore:
        storeCount >= 2 && scores.length ? Math.max(...scores) : 0,
      variants: Array.from(
        new Set(
          offers
            .map((offer: OfferView) => offer.variantLabel)
            .filter(Boolean) as string[],
        ),
      ),
    });
  }

  return filtered;
}


function variantSignature(offer: OfferView) {
  return Object.entries(offer.variantData || {})
    .filter(
      ([key, value]) =>
        Boolean(value) && !(key === 'condition' && value === 'New'),
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|') || 'base';
}

function rescoreProduct(product: ProductResult): ProductResult {
  const groups = new Map<string, OfferView[]>();

  for (const offer of product.offers) {
    const key = variantSignature(offer);
    groups.set(key, [...(groups.get(key) || []), offer]);
  }

  const rescored: OfferView[] = [];

  for (const offers of groups.values()) {
    const merchants = new Set(
      offers.map(
        (offer) => offerDomain(offer) || offer.merchant.toLowerCase(),
      ),
    );

    const prices = offers
      .map((offer) => offer.totalPrice)
      .filter((price) => Number.isFinite(price) && price > 0)
      .sort((a, b) => a - b);

    const reference =
      prices.length % 2
        ? prices[Math.floor(prices.length / 2)]
        : prices.length
          ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
          : 0;

    const min = prices[0] || 0;
    let bestIndex = -1;
    let bestScore = -1;

    const group = offers.map((offer, index) => {
      if (merchants.size < 2 || !reference) {
        return {
          ...offer,
          dealScore: 0,
          isCheapest: false,
          isBestOverall: false,
        };
      }

      const relative = (reference - offer.totalPrice) / reference;
      let score = 82 + relative * 160;

      if (offer.sellerRating != null) {
        score += Math.max(-2, Math.min(2, (offer.sellerRating - 4) * 2));
      }

      score = Math.round(Math.max(60, Math.min(94, score)));

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }

      return {
        ...offer,
        dealScore: score,
        isCheapest: Math.abs(offer.totalPrice - min) < 0.001,
        isBestOverall: false,
      };
    });

    if (bestIndex >= 0) {
      group[bestIndex] = {
        ...group[bestIndex],
        isBestOverall: true,
      };
    }

    rescored.push(...group);
  }

  const storesCount = new Set(
    rescored.map(
      (offer) => offerDomain(offer) || offer.merchant.toLowerCase(),
    ),
  ).size;

  const meaningful = rescored
    .map((offer) => offer.dealScore)
    .filter((score) => score > 0);

  return {
    ...product,
    offers: rescored.sort((a, b) => {
      if (a.isBestOverall !== b.isBestOverall) {
        return a.isBestOverall ? -1 : 1;
      }
      return a.totalPrice - b.totalPrice;
    }),
    bestPrice: rescored.length
      ? Math.min(...rescored.map((offer) => offer.totalPrice))
      : product.bestPrice,
    storesCount,
    dealScore: meaningful.length ? Math.max(...meaningful) : 0,
    variants: Array.from(
      new Set(
        rescored
          .map((offer) => offer.variantLabel)
          .filter(Boolean) as string[],
      ),
    ),
  };
}

function rescoreProducts(products: ProductResult[]) {
  return products.map(rescoreProduct);
}

function familyKey(product: ProductResult) {
  return canonicalizeProductTitle(product.title)
    .toLowerCase()
    .replace(/[^a-z0-9āčēģīķļņōŗšūž]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function offerKey(offer: OfferView) {
  const variant = Object.entries(offer.variantData || {})
    .filter(
      ([key, value]) =>
        Boolean(value) && !(key === 'condition' && value === 'New'),
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');

  return `${offerDomain(offer) || offer.merchant.toLowerCase()}|${variant}|${offer.totalPrice.toFixed(2)}`;
}

function normalizedWords(value: string): string[] {
  return canonicalizeProductTitle(value)
    .toLowerCase()
    .replace(/[^a-z0-9āčēģīķļņōŗšūž]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function queryRelevance(product: ProductResult, query: string) {
  const wanted = normalizedWords(query).filter(
    (token: string) => !['apple', 'samsung', 'google'].includes(token),
  );
  const title = normalizedWords(product.title);

  if (!wanted.length || !title.length) return 0;

  const titleSet = new Set(title);
  const matched = wanted.filter((token: string) => titleSet.has(token)).length;
  const coverage = matched / wanted.length;

  if (coverage < 1) return coverage * 30;

  const extra = title.filter(
    (token: string) =>
      !wanted.includes(token) &&
      !['apple', 'samsung', 'google'].includes(token),
  ).length;

  let score = 100 - Math.min(45, extra * 7);

  const queryCore = wanted.join(' ');
  const titleCore = title
    .filter((token: string) => !['apple', 'samsung', 'google'].includes(token))
    .join(' ');

  if (titleCore === queryCore) score += 20;

  if (
    /\b(pro|max|plus|ultra|fe|edge|fold|flip|case|cover|glass|charger|cable|adapter|accessor)\b/i.test(
      titleCore,
    ) &&
    !/\b(pro|max|plus|ultra|fe|edge|fold|flip|case|cover|glass|charger|cable|adapter|accessor)\b/i.test(
      queryCore,
    )
  ) {
    score -= 22;
  }

  return score;
}

function rankForQuery(products: ProductResult[], query: string) {
  const ranked = products
    .map((product) => ({
      product,
      relevance: queryRelevance(product, query),
    }))
    .filter((item) => item.relevance >= 55)
    .sort(
      (a, b) =>
        b.relevance - a.relevance ||
        (b.product.storesCount || 0) - (a.product.storesCount || 0) ||
        a.product.bestPrice - b.product.bestPrice,
    );

  if (!ranked.length) return products.slice(0, 12);

  const best = ranked[0].relevance;

  return ranked
    .filter((item) => item.relevance >= best - 24)
    .slice(0, 12)
    .map((item) => item.product);
}

function pruneExtremeLowOffers(offers: OfferView[]) {
  if (offers.length < 2) return offers;

  const sortedPrices = offers
    .map((offer) => offer.totalPrice)
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);

  if (sortedPrices.length < 2) return offers;

  const reference =
    sortedPrices.length === 2
      ? sortedPrices[1]
      : sortedPrices[Math.floor(sortedPrices.length / 2)];

  if (reference < 100) return offers;

  const cleaned = offers.filter(
    (offer) => offer.totalPrice >= reference * 0.38,
  );

  return cleaned.length ? cleaned : offers;
}

function mergeProductResults(groups: ProductResult[][]) {
  const map = new Map<string, ProductResult>();

  for (const products of groups) {
    for (const product of products) {
      const key =
        familyKey(product) ||
        product.normalizedTitle ||
        product.title.toLowerCase();

      const current = map.get(key);

      if (!current) {
        map.set(key, {
          ...product,
          offers: [...product.offers],
        });
        continue;
      }

      const offers = new Map<string, OfferView>();

      for (const offer of [...current.offers, ...product.offers]) {
        const key = offerKey(offer);
        const existing = offers.get(key);

        if (!existing || offer.totalPrice < existing.totalPrice) {
          offers.set(key, offer);
        }
      }

      const mergedOffers = pruneExtremeLowOffers(
        Array.from(offers.values()).sort(
          (a, b) => a.totalPrice - b.totalPrice,
        ),
      );

      const storeCount = new Set(
        mergedOffers.map(
          (offer) =>
            offerDomain(offer) || offer.merchant.toLowerCase(),
        ),
      ).size;

      const scores = mergedOffers
        .map((offer) => offer.dealScore)
        .filter((score) => score > 0);

      const preferred =
        current.externalId?.startsWith('catalog:')
          ? current
          : product.externalId?.startsWith('catalog:')
            ? product
            : current;

      map.set(key, {
        ...preferred,
        title:
          current.title.length <= product.title.length
            ? current.title
            : product.title,
        brand: current.brand || product.brand,
        image:
          current.image ||
          product.image ||
          mergedOffers.find((offer) => Boolean(offer.image))?.image,
        bestPrice: Math.min(
          ...mergedOffers.map((offer) => offer.totalPrice),
        ),
        currency:
          mergedOffers[0]?.currency ||
          current.currency ||
          product.currency,
        dealScore:
          storeCount >= 2 && scores.length ? Math.max(...scores) : 0,
        offers: mergedOffers,
        storesCount: storeCount,
        variants: Array.from(
          new Set(
            mergedOffers
              .map((offer) => offer.variantLabel)
              .filter(Boolean) as string[],
          ),
        ),
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const coverage = (b.storesCount || 0) - (a.storesCount || 0);
    if (coverage) return coverage;

    return b.dealScore - a.dealScore || a.bestPrice - b.bestPrice;
  });
}

function resultCoverage(products: ProductResult[]) {
  return Math.max(
    0,
    ...products.map((item) => item.storesCount || 0),
  );
}

function resultVariantCount(products: ProductResult[]) {
  return Math.max(
    0,
    ...products.map((item) => item.variants?.length || 0),
  );
}

async function getCachedResults(query: string) {
  if (!databaseConfigured()) return null;

  try {
    const cache = await prisma.searchCache.findUnique({
      where: { key: normalizeCacheKey(query) },
    });

    if (!cache || cache.expiresAt <= new Date()) return null;
    return cache.results as unknown as ProductResult[];
  } catch {
    return null;
  }
}

async function saveCachedResults(query: string, results: ProductResult[]) {
  if (!databaseConfigured()) return;

  const expiresAt = new Date(
    Date.now() + CACHE_MINUTES * 60 * 1000,
  );

  const jsonResults = JSON.parse(JSON.stringify(results));

  await prisma.searchCache
    .upsert({
      where: { key: normalizeCacheKey(query) },
      create: {
        key: normalizeCacheKey(query),
        query,
        results: jsonResults,
        expiresAt,
      },
      update: {
        query,
        results: jsonResults,
        expiresAt,
      },
    })
    .catch(() => undefined);
}

async function fallbackSearch(q: string) {
  let raw = await searchProductsFast(q, true);

  let mapped = rankForQuery(
    filterApprovedMerchants(mapFastProductSearch(raw)),
    q,
  );

  if (!mapped.length) {
    raw = await searchProductsFast(q, false);
    mapped = rankForQuery(
      filterApprovedMerchants(mapFastProductSearch(raw)),
      q,
    );
  }

  if (!mapped.length) return [] as ProductResult[];

  return persistProducts(rescoreProducts(mapped));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
) {
  return Promise.race([
    promise,
    new Promise<T>((resolve) =>
      setTimeout(() => resolve(fallback), timeoutMs),
    ),
  ]);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const q = String(body?.q || '').trim();
    const mode = body?.mode === 'assistant' ? 'assistant' : 'search';

    if (!q) {
      return NextResponse.json(
        { error: 'Ievadi meklējamo produktu.' },
        { status: 400 },
      );
    }

    if (isRestrictedShoppingQuery(q)) {
      return NextResponse.json(
        { error: 'Ceniq šo produktu kategoriju nemeklē.' },
        { status: 400 },
      );
    }

    let catalogResults: ProductResult[] = [];

    if (databaseConfigured()) {
      const user = await getSessionUser();

      prisma.searchLog
        .create({
          data: {
            query: q.slice(0, 700),
            mode,
            userId: user?.id,
          },
        })
        .catch(() => undefined);

      catalogResults = rankForQuery(
        await searchCatalog(canonicalizeProductTitle(q) || q),
        q,
      );

      if (
        catalogResults.length &&
        resultCoverage(catalogResults) >= 3 &&
        resultVariantCount(catalogResults) >= 2
      ) {
        return NextResponse.json({
          results: rankForQuery(
            rescoreProducts(mergeProductResults([catalogResults])),
            q,
          ),
          source: 'ceniq-catalog',
          cached: false,
        });
      }
    }

    const cached = await getCachedResults(q);

    if (
      cached?.length &&
      resultCoverage(cached) >= 3 &&
      resultVariantCount(cached) >= 2
    ) {
      return NextResponse.json({
        results: cached,
        source: 'ceniq-cache-v34',
        cached: true,
      });
    }

    // 3.4: enrich the PRODUCT FAMILY first, so a search like
    // "iPhone 16 128GB" can still learn 256GB / other colours for the same family.
    // This replaces the old 16-store sequential crawler.
    const familyQuery = canonicalizeProductTitle(q) || q;

    if (databaseConfigured()) {
      await withTimeout(
        enrichCatalogFromApprovedStores(familyQuery),
        8000,
        {
          skipped: true,
          reason: 'timeout',
          pages: 0,
          offers: 0,
          families: 0,
        },
      );

      catalogResults = rankForQuery(
        await searchCatalog(familyQuery),
        q,
      );
    }

    let fallbackResults: ProductResult[] = cached?.length ? cached : [];

    // Only spend another generic DataForSEO request when the targeted
    // approved-store adapter layer still did not produce useful coverage.
    if (resultCoverage(catalogResults) < 2) {
      fallbackResults = await fallbackSearch(q).catch(
        () => fallbackResults,
      );
    }
    const merged = rankForQuery(
      rescoreProducts(
        mergeProductResults([catalogResults, fallbackResults]),
      ),
      q,
    );

    if (merged.length) {
      await saveCachedResults(q, merged);

      return NextResponse.json({
        results: merged,
        source: catalogResults.length
          ? 'ceniq-hybrid'
          : 'approved-store-fallback',
        cached: false,
      });
    }

    return NextResponse.json({
      results: [],
      source: 'ceniq-catalog',
      cached: false,
      message:
        'CENIQ neatrada drošus salīdzināmus piedāvājumus mūsu veikalu sarakstā.',
    });
  } catch (error) {
    console.error('Ceniq search:', error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Meklēšana neizdevās.',
      },
      { status: 502 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'Search polling is no longer used.' },
    { status: 410 },
  );
}
