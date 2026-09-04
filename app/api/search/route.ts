import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { databaseConfigured, prisma } from '@/lib/db';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import { searchCanonicalCatalog } from '@/lib/canonical/catalog';
import { shapeCanonicalResults } from '@/lib/canonical/result-shaping';
import { expandDiscoveryQueries } from '@/lib/canonical/query-expansion';
import { canonicalizeMerchantProductTitle } from '@/lib/canonical/title-normalization';
import { normalizeText } from '@/lib/canonical/domain';

export const maxDuration = 10;

function coverage(results: Awaited<ReturnType<typeof searchCanonicalCatalog>>) {
  return Math.max(0, ...results.map((product) => product.storesCount || 0));
}

function variantCount(results: Awaited<ReturnType<typeof searchCanonicalCatalog>>) {
  return Math.max(
    0,
    ...results.map(
      (product) => product.catalogVariants?.filter((variant) => variant.offerCount > 0).length || 0,
    ),
  );
}

async function searchCatalogWithFallback(query: string) {
  const primary = await searchCanonicalCatalog(query);
  const canonicalQuery = canonicalizeMerchantProductTitle(query).title.trim();
  if (!canonicalQuery || normalizeText(canonicalQuery) === normalizeText(query)) return primary;

  const fallback = await searchCanonicalCatalog(canonicalQuery);
  const merged = new Map(primary.map((product) => [product.id, product]));
  for (const product of fallback) if (!merged.has(product.id)) merged.set(product.id, product);
  return Array.from(merged.values());
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const q = String(body?.q || '').trim();
    const mode = body?.mode === 'assistant' ? 'assistant' : 'search';

    if (!q) return NextResponse.json({ error: 'Ievadi meklējamo produktu.' }, { status: 400 });
    if (isRestrictedShoppingQuery(q)) return NextResponse.json({ error: 'CENIQ šo produktu kategoriju nemeklē.' }, { status: 400 });
    if (!databaseConfigured()) return NextResponse.json({ error: 'CENIQ katalogam nav konfigurēta datubāze.' }, { status: 503 });

    const user = await getSessionUser();
    prisma.searchLog
      .create({ data: { query: q.slice(0, 700), mode, userId: user?.id } })
      .catch(() => undefined);

    // First response stays DB-only and fast. Provider discovery always refreshes in the
    // background so a cached product can never become a permanent dead end.
    const rawResults = await searchCatalogWithFallback(q);
    const results = shapeCanonicalResults(rawResults, q);
    const bestCoverage = coverage(results);
    const bestVariants = variantCount(results);

    return NextResponse.json({
      results,
      source: 'canonical-catalog',
      cached: true,
      discoveryQueries: expandDiscoveryQueries(q),
      diagnostics: {
        rawProductGroups: rawResults.length,
        productGroups: results.length,
        bestCoverage,
        bestVariants,
        families: results.map((product) => ({
          id: product.id,
          title: product.title,
          stores: product.storesCount || 0,
          variants: product.catalogVariants?.filter((variant) => variant.offerCount > 0).length || 0,
          offers: product.offers?.length || 0,
          hasImage: Boolean(product.image),
          variantAxes: Array.from(
            new Set(
              (product.catalogVariants || []).flatMap((variant) => Object.keys(variant.attributes || {})),
            ),
          ),
        })),
      },
      expansion: { enabled: true, query: q },
      enrichment: { enabled: false, query: q, jobId: null },
    });
  } catch (error) {
    console.error('CENIQ canonical search:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Meklēšana neizdevās.' },
      { status: 502 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Search polling is not used.' }, { status: 410 });
}
