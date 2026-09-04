import { NextResponse } from 'next/server';
import {
  mapFastProductSearch,
  searchProductsFast,
} from '@/lib/dataforseo';
import { getSessionUser } from '@/lib/auth';
import {
  databaseConfigured,
  prisma,
} from '@/lib/db';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import type { ProductResult } from '@/lib/types';
import {
  familyQuery,
  normalizeLiveProducts,
  persistMarketProducts,
  searchMarketCatalog,
} from '@/lib/merchant-engine';

export const maxDuration = 20;

const CACHE_MINUTES = Math.min(
  60,
  Math.max(
    5,
    Number(process.env.SEARCH_CACHE_MINUTES || 20),
  ),
);

function cacheKey(query: string) {
  return `v35:${query.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

async function readCache(query: string) {
  if (!databaseConfigured()) return null;

  const row = await prisma.searchCache
    .findUnique({
      where: { key: cacheKey(query) },
    })
    .catch(() => null);

  if (!row || row.expiresAt <= new Date()) return null;

  return row.results as unknown as ProductResult[];
}

async function writeCache(query: string, results: ProductResult[]) {
  if (!databaseConfigured() || !results.length) return;

  const expiresAt = new Date(
    Date.now() + CACHE_MINUTES * 60 * 1000,
  );

  await prisma.searchCache
    .upsert({
      where: { key: cacheKey(query) },
      create: {
        key: cacheKey(query),
        query,
        results: JSON.parse(JSON.stringify(results)),
        expiresAt,
      },
      update: {
        query,
        results: JSON.parse(JSON.stringify(results)),
        expiresAt,
      },
    })
    .catch(() => undefined);
}

function coverage(results: ProductResult[]) {
  return Math.max(
    0,
    ...results.map((product) => product.storesCount || 0),
  );
}

function variants(results: ProductResult[]) {
  return Math.max(
    0,
    ...results.map((product) => product.variants?.length || 0),
  );
}

function shouldEnrich(results: ProductResult[]) {
  return (
    !results.length ||
    coverage(results) < 5 ||
    variants(results) < 2
  );
}

async function liveSearch(q: string) {
  let raw = await searchProductsFast(q, true);
  let mapped = normalizeLiveProducts(
    mapFastProductSearch(raw),
    q,
  );

  if (!mapped.length) {
    raw = await searchProductsFast(q, false);
    mapped = normalizeLiveProducts(
      mapFastProductSearch(raw),
      q,
    );
  }

  return mapped;
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

      const catalog = await searchMarketCatalog(q);

      if (catalog.length) {
        return NextResponse.json({
          results: catalog,
          source: 'ceniq-market',
          cached: true,
          enrichment: {
            enabled: shouldEnrich(catalog),
            query: familyQuery(q),
          },
        });
      }
    }

    const cached = await readCache(q);

    if (cached?.length) {
      return NextResponse.json({
        results: cached,
        source: 'ceniq-cache-v35',
        cached: true,
        enrichment: {
          enabled: shouldEnrich(cached),
          query: familyQuery(q),
        },
      });
    }

    const mapped = await liveSearch(q);

    let results = mapped;

    if (databaseConfigured() && mapped.length) {
      results = await persistMarketProducts(mapped);
      await writeCache(q, results);
    }

    return NextResponse.json({
      results,
      source: results.length ? 'ceniq-live' : 'ceniq-live-empty',
      cached: false,
      enrichment: {
        enabled: true,
        query: familyQuery(q),
      },
      message:
        results.length === 0
          ? 'Ātrais meklējums neko drošu neatrada — CENIQ turpina pārbaudīt Google Shopping katalogu.'
          : undefined,
    });
  } catch (error) {
    console.error('CENIQ search:', error);

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
