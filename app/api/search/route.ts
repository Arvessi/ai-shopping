import { NextResponse } from 'next/server';
import { mapFastProductSearch, searchProductsFast } from '@/lib/dataforseo';
import { persistProducts } from '@/lib/products';
import { getSessionUser } from '@/lib/auth';
import { databaseConfigured, prisma } from '@/lib/db';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import type { ProductResult } from '@/lib/types';

export const maxDuration = 60;

const CACHE_MINUTES = Math.min(
  180,
  Math.max(5, Number(process.env.SEARCH_CACHE_MINUTES || 30)),
);

function normalizeCacheKey(query: string) {
  return query
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function getCachedResults(query: string) {
  if (!databaseConfigured()) return null;

  try {
    const cache = await prisma.searchCache.findUnique({
      where: { key: normalizeCacheKey(query) },
    });

    if (!cache || cache.expiresAt <= new Date()) {
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
  if (!databaseConfigured()) return;

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + CACHE_MINUTES * 60 * 1000,
  );

  // JSON.parse/stringify strips undefined values so Prisma receives valid JSON.
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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const q = String(body?.q || '').trim();
    const mode =
      body?.mode === 'assistant' ? 'assistant' : 'search';

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
    }

    const cached = await getCachedResults(q);

    if (cached?.length) {
      return NextResponse.json({
        results: cached,
        source: 'ceniq-cache',
        cached: true,
      });
    }

    // Shopping first: better chance of structured products + real images.
    let raw = await searchProductsFast(q, true);
    let mapped = mapFastProductSearch(raw);

    // Latvia occasionally returns no usable Shopping block. Only then spend
    // one extra request on ordinary Google SERP as a fallback.
    if (!mapped.length) {
      raw = await searchProductsFast(q, false);
      mapped = mapFastProductSearch(raw);
    }

    if (!mapped.length) {
      return NextResponse.json({
        results: [],
        source: 'dataforseo-serp-live',
        cached: false,
        message:
          'Google šim vaicājumam neatgrieza salīdzināmus produktu piedāvājumus. Pamēģini precīzāku modeļa nosaukumu.',
      });
    }

    const results = await persistProducts(mapped);
    await saveCachedResults(q, results);

    return NextResponse.json({
      results,
      source: 'dataforseo-serp-live',
      cached: false,
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
