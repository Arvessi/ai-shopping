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
  crawlQueryCandidates,
  ensureCrawlerRegistry,
} from '@/lib/crawler';
import {
  ALLOWED_MERCHANT_DOMAINS,
  LATVIA_ELECTRONICS_STORES,
  type StoreSeed,
} from '@/lib/store-registry';

export const maxDuration = 60;

const CACHE_MINUTES = Math.min(
  180,
  Math.max(
    5,
    Number(
      process.env.SEARCH_CACHE_MINUTES ||
        30,
    ),
  ),
);

function normalizeCacheKey(
  query: string,
) {
  return `v33:${query
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()}`;
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

function normalizedDomain(
  value?: string,
) {
  if (!value) return '';

  try {
    return new URL(
      value.includes('://')
        ? value
        : `https://${value}`,
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

function isApprovedDomain(
  domain: string,
) {
  const normalized =
    normalizedDomain(domain);

  return ALLOWED_MERCHANT_DOMAINS.some(
    (allowed: string) =>
      normalized === allowed ||
      normalized.endsWith(
        `.${allowed}`,
      ) ||
      allowed.endsWith(
        `.${normalized}`,
      ),
  );
}

function offerDomain(
  offer: OfferView,
) {
  if (offer.merchantDomain) {
    return normalizedDomain(
      offer.merchantDomain,
    );
  }

  if (offer.url) {
    return normalizedDomain(
      offer.url,
    );
  }

  return '';
}

function filterApprovedMerchants(
  products: ProductResult[],
) {
  const filtered: ProductResult[] = [];

  for (const product of products) {
    const offers = product.offers.filter(
      (offer: OfferView) => {
        const domain =
          offerDomain(offer);

        if (domain) {
          return isApprovedDomain(
            domain,
          );
        }

        const merchant =
          offer.merchant
            .toLowerCase()
            .replace(
              /[^a-z0-9āčēģīķļņōŗšūž]+/gi,
              '',
            );

        return ALLOWED_MERCHANT_NAMES.some(
          (name: string) =>
            merchant === name ||
            merchant.startsWith(name) ||
            name.startsWith(merchant),
        );
      },
    );

    if (!offers.length) continue;

    const bestPrice = Math.min(
      ...offers.map(
        (offer: OfferView) =>
          offer.totalPrice,
      ),
    );

    const storeCount =
      new Set(
        offers.map(
          (offer: OfferView) =>
            offerDomain(
              offer,
            ) ||
            offer.merchant.toLowerCase(),
        ),
      ).size;

    const scores = offers
      .map(
        (offer: OfferView) =>
          offer.dealScore,
      )
      .filter(
        (score: number) => score > 0,
      );

    filtered.push({
      ...product,
      offers,
      bestPrice,
      storesCount: storeCount,
      dealScore:
        storeCount >= 2 &&
        scores.length
          ? Math.max(...scores)
          : 0,
      variants:
        Array.from(
          new Set(
            offers
              .map(
                (offer: OfferView) =>
                  offer.variantLabel,
              )
              .filter(
                Boolean,
              ) as string[],
          ),
        ),
    });
  }

  return filtered;
}

function familyKey(
  product: ProductResult,
) {
  return canonicalizeProductTitle(
    product.title,
  )
    .toLowerCase()
    .replace(
      /[^a-z0-9āčēģīķļņōŗšūž]+/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function offerKey(
  offer: OfferView,
) {
  const variant =
    Object.entries(
      offer.variantData ||
        {},
    )
      .filter(
        ([key, value]) =>
          Boolean(value) &&
          !(
            key ===
              'condition' &&
            value === 'New'
          ),
      )
      .sort(
        ([a], [b]) =>
          a.localeCompare(b),
      )
      .map(
        ([key, value]) =>
          `${key}:${value}`,
      )
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

function queryRelevance(
  product: ProductResult,
  query: string,
) {
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

  if (/\b(pro|max|plus|ultra|fe|edge|fold|flip|case|cover|glass|charger|cable|adapter|accessor)/i.test(titleCore) &&
      !/\b(pro|max|plus|ultra|fe|edge|fold|flip|case|cover|glass|charger|cable|adapter|accessor)/i.test(queryCore)) {
    score -= 22;
  }

  return score;
}

function rankForQuery(
  products: ProductResult[],
  query: string,
) {
  const ranked = products
    .map((product) => ({
      product,
      relevance: queryRelevance(product, query),
    }))
    .filter((item) => item.relevance >= 55)
    .sort((a, b) =>
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

function pruneExtremeLowOffers(
  offers: OfferView[],
) {
  if (offers.length < 2) return offers;

  const sortedPrices = offers
    .map((offer) => offer.totalPrice)
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);

  if (sortedPrices.length < 2) return offers;

  let reference: number;
  if (sortedPrices.length === 2) {
    reference = sortedPrices[1];
  } else {
    const mid = Math.floor(sortedPrices.length / 2);
    reference = sortedPrices.length % 2
      ? sortedPrices[mid]
      : (sortedPrices[mid - 1] + sortedPrices[mid]) / 2;
  }

  if (reference < 100) return offers;

  const cleaned = offers.filter(
    (offer) => offer.totalPrice >= reference * 0.38,
  );

  return cleaned.length ? cleaned : offers;
}

function mergeProductResults(
  groups: ProductResult[][],
) {
  const map = new Map<
    string,
    ProductResult
  >();

  for (const products of groups) {
    for (const product of products) {
      const key =
        familyKey(product) ||
        product.normalizedTitle ||
        product.title.toLowerCase();

      const current =
        map.get(key);

      if (!current) {
        map.set(key, {
          ...product,
          offers: [
            ...product.offers,
          ],
        });

        continue;
      }

      const offers =
        new Map<
          string,
          OfferView
        >();

      for (const offer of [
        ...current.offers,
        ...product.offers,
      ]) {
        const key =
          offerKey(offer);

        const existing =
          offers.get(key);

        if (
          !existing ||
          offer.totalPrice <
            existing.totalPrice
        ) {
          offers.set(
            key,
            offer,
          );
        }
      }

      let mergedOffers =
        Array.from(
          offers.values(),
        ).sort(
          (a, b) =>
            a.totalPrice -
            b.totalPrice,
        );

      mergedOffers =
        pruneExtremeLowOffers(
          mergedOffers,
        );

      const storeCount =
        new Set(
          mergedOffers.map(
            (offer) =>
              offerDomain(
                offer,
              ) ||
              offer.merchant.toLowerCase(),
          ),
        ).size;

      const scores =
        mergedOffers
          .map(
            (offer) =>
              offer.dealScore,
          )
          .filter(
            (score) =>
              score > 0,
          );

      const preferred =
        current.id &&
        !current.externalId.startsWith(
          'family:',
        )
          ? current
          : product;

      map.set(key, {
        ...preferred,
        title:
          current.title.length <=
          product.title.length
            ? current.title
            : product.title,
        brand:
          current.brand ||
          product.brand,
        image:
          current.image ||
          product.image ||
          mergedOffers.find(
            (offer) =>
              Boolean(
                offer.image,
              ),
          )?.image,
        bestPrice:
          Math.min(
            ...mergedOffers.map(
              (offer) =>
                offer.totalPrice,
            ),
          ),
        currency:
          mergedOffers[0]
            ?.currency ||
          current.currency ||
          product.currency,
        dealScore:
          storeCount >= 2 &&
          scores.length
            ? Math.max(
                ...scores,
              )
            : 0,
        offers:
          mergedOffers,
        storesCount:
          storeCount,
        variants:
          Array.from(
            new Set(
              mergedOffers
                .map(
                  (offer) =>
                    offer.variantLabel,
                )
                .filter(
                  Boolean,
                ) as string[],
            ),
          ),
      });
    }
  }

  return Array.from(
    map.values(),
  ).sort((a, b) => {
    const coverage =
      (b.storesCount ||
        0) -
      (a.storesCount ||
        0);

    if (coverage) {
      return coverage;
    }

    return (
      b.dealScore -
        a.dealScore ||
      a.bestPrice -
        b.bestPrice
    );
  });
}

function resultCoverage(
  products: ProductResult[],
) {
  return Math.max(
    0,
    ...products.map(
      (item) =>
        item.storesCount ||
        0,
    ),
  );
}

function resultVariantCount(
  products: ProductResult[],
) {
  return Math.max(
    0,
    ...products.map(
      (item) =>
        item.variants
          ?.length ||
        0,
    ),
  );
}

async function getCachedResults(
  query: string,
) {
  if (!databaseConfigured()) {
    return null;
  }

  try {
    const cache =
      await prisma.searchCache.findUnique({
        where: {
          key:
            normalizeCacheKey(
              query,
            ),
        },
      });

    if (
      !cache ||
      cache.expiresAt <=
        new Date()
    ) {
      return null;
    }

    return cache.results as unknown as ProductResult[];
  } catch {
    return null;
  }
}

async function saveCachedResults(
  query: string,
  results: ProductResult[],
) {
  if (!databaseConfigured()) {
    return;
  }

  const now = new Date();

  const expiresAt = new Date(
    now.getTime() +
      CACHE_MINUTES *
        60 *
        1000,
  );

  const jsonResults =
    JSON.parse(
      JSON.stringify(
        results,
      ),
    );

  await prisma.searchCache
    .upsert({
      where: {
        key:
          normalizeCacheKey(
            query,
          ),
      },
      create: {
        key:
          normalizeCacheKey(
            query,
          ),
        query,
        results:
          jsonResults,
        expiresAt,
      },
      update: {
        query,
        results:
          jsonResults,
        expiresAt,
      },
    })
    .catch(
      () => undefined,
    );
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      await request.json();

    const q = String(
      body?.q || '',
    ).trim();

    const mode =
      body?.mode ===
      'assistant'
        ? 'assistant'
        : 'search';

    if (!q) {
      return NextResponse.json(
        {
          error:
            'Ievadi meklējamo produktu.',
        },
        { status: 400 },
      );
    }

    if (
      isRestrictedShoppingQuery(
        q,
      )
    ) {
      return NextResponse.json(
        {
          error:
            'Ceniq šo produktu kategoriju nemeklē.',
        },
        { status: 400 },
      );
    }

    let catalogResults:
      ProductResult[] = [];

    if (
      databaseConfigured()
    ) {
      const user =
        await getSessionUser();

      prisma.searchLog
        .create({
          data: {
            query:
              q.slice(
                0,
                700,
              ),
            mode,
            userId:
              user?.id,
          },
        })
        .catch(
          () => undefined,
        );

      await ensureCrawlerRegistry();

      catalogResults =
        rankForQuery(
          await searchCatalog(q),
          q,
        );

      const weakCoverage =
        resultCoverage(
          catalogResults,
        ) < 3;

      const weakVariants =
        resultVariantCount(
          catalogResults,
        ) < 2;

      if (
        !catalogResults.length ||
        weakCoverage ||
        weakVariants
      ) {
        const crawl =
          await crawlQueryCandidates(
            q,
            16,
          ).catch(
            () => ({
              pages: 0,
              products: 0,
            }),
          );

        if (
          crawl.products > 0
        ) {
          catalogResults =
            rankForQuery(
              await searchCatalog(
                q,
              ),
              q,
            );
        }
      }

      if (
        catalogResults.length &&
        resultCoverage(
          catalogResults,
        ) >= 3
      ) {
        return NextResponse.json({
          results:
            rankForQuery(
              mergeProductResults([
                catalogResults,
              ]),
              q,
            ),
          source:
            'ceniq-catalog',
          cached: false,
        });
      }
    }

    const cached =
      await getCachedResults(
        q,
      );

    if (
      cached?.length &&
      resultCoverage(
        catalogResults,
      ) === 0
    ) {
      return NextResponse.json({
        results: cached,
        source:
          'ceniq-cache-v33',
        cached: true,
      });
    }

    // Paid fallback only when our own catalog still lacks enough coverage.
    let raw =
      await searchProductsFast(
        q,
        true,
      );

    let mapped =
      rankForQuery(
        filterApprovedMerchants(
          mapFastProductSearch(
            raw,
          ),
        ),
        q,
      );

    if (!mapped.length) {
      raw =
        await searchProductsFast(
          q,
          false,
        );

      mapped =
        rankForQuery(
          filterApprovedMerchants(
            mapFastProductSearch(
              raw,
            ),
          ),
          q,
        );
    }

    let fallbackResults:
      ProductResult[] = [];

    if (mapped.length) {
      fallbackResults =
        await persistProducts(
          mapped,
        );
    }

    const merged =
      rankForQuery(
        mergeProductResults([
          catalogResults,
          fallbackResults,
        ]),
        q,
      );

    if (
      merged.length
    ) {
      await saveCachedResults(
        q,
        merged,
      );

      return NextResponse.json({
        results: merged,
        source:
          catalogResults.length
            ? 'ceniq-hybrid'
            : 'approved-store-fallback',
        cached: false,
      });
    }

    return NextResponse.json({
      results: [],
      source:
        'ceniq-catalog',
      cached: false,
      message:
        'CENIQ neatrada drošus salīdzināmus piedāvājumus mūsu veikalu sarakstā.',
    });
  } catch (error) {
    console.error(
      'Ceniq search:',
      error,
    );

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
    {
      error:
        'Search polling is no longer used.',
    },
    { status: 410 },
  );
}
