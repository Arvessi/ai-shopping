import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { databaseConfigured, prisma } from '@/lib/db';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import { searchCanonicalCatalog } from '@/lib/canonical/catalog';
import { shapeCanonicalResults } from '@/lib/canonical/result-shaping';
import { expandDiscoveryQueries } from '@/lib/canonical/query-expansion';

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

    // First response is DB-only on purpose. Provider discovery lives in /api/search/expand
    // so a cold search can never force the user to retry two or three times.
    const rawResults = await searchCanonicalCatalog(q);
    const results = shapeCanonicalResults(rawResults, q);
    const bestCoverage = coverage(results);
    const bestVariants = variantCount(results);
    const expansionEnabled =
      !results.length || bestCoverage < 8 || bestVariants < 3 || results.length < 2;

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
      expansion: { enabled: expansionEnabled, query: q },
      enrichment: { enabled: false, query: q, jobId: null },
      message: !results.length && !expansionEnabled
        ? 'CENIQ neatrada derīgus veikalu piedāvājumus šiem meklēšanas vārdiem.'
        : undefined,
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
