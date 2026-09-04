import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { databaseConfigured, prisma } from '@/lib/db';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import { ingestCandidates, searchCanonicalCatalog } from '@/lib/canonical/catalog';
import { discoverShoppingLiveMany, mapShoppingCandidates } from '@/lib/canonical/dataforseo-client';
import { discoverLatvianStoreCandidates } from '@/lib/canonical/store-discovery';
import { shapeCanonicalResults } from '@/lib/canonical/result-shaping';
import { expandDiscoveryQueries } from '@/lib/canonical/query-expansion';

export const maxDuration = 30;

function coverage(results: Awaited<ReturnType<typeof searchCanonicalCatalog>>) {
  return Math.max(0, ...results.map((product) => product.storesCount || 0));
}

function variantCount(results: Awaited<ReturnType<typeof searchCanonicalCatalog>>) {
  return Math.max(0, ...results.map((product) => product.catalogVariants?.filter((variant) => variant.offerCount > 0).length || 0));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const q = String(body?.q || '').trim();
    const mode = body?.mode === 'assistant' ? 'assistant' : 'search';

    if (!q) return NextResponse.json({ error: 'Ievadi meklejamo produktu.' }, { status: 400 });
    if (isRestrictedShoppingQuery(q)) return NextResponse.json({ error: 'Ceniq so produktu kategoriju nemekle.' }, { status: 400 });
    if (!databaseConfigured()) return NextResponse.json({ error: 'CENIQ katalogam nav konfigureta datubaze.' }, { status: 503 });

    const user = await getSessionUser();
    prisma.searchLog.create({ data: { query: q.slice(0, 700), mode, userId: user?.id } }).catch(() => undefined);

    let rawResults = await searchCanonicalCatalog(q);
    let results = shapeCanonicalResults(rawResults, q);
    let source = 'canonical-catalog';
    let liveCandidateCount = 0;
    let lvStoreCandidateCount = 0;
    const discoveryQueries = expandDiscoveryQueries(q);

    const thin = !results.length || coverage(results) < 5 || variantCount(results) < 3 || results.length < 2;

    if (thin) {
      // The expensive per-store page crawl is only needed on a cold catalog. Once we
      // already have results, expand models/storage through one batched live request.
      // This keeps the first response comfortably below the browser timeout.
      const livePromise = discoverShoppingLiveMany(discoveryQueries).then(mapShoppingCandidates);
      const storePromise = !results.length ? discoverLatvianStoreCandidates(q) : Promise.resolve([]);
      const [liveResult, storeResult] = await Promise.allSettled([livePromise, storePromise]);

      const liveCandidates = liveResult.status === 'fulfilled' ? liveResult.value : [];
      const storeCandidates = storeResult.status === 'fulfilled' ? storeResult.value : [];
      liveCandidateCount = liveCandidates.length;
      lvStoreCandidateCount = storeCandidates.length;

      if (liveResult.status === 'rejected') console.error('CENIQ live shopping discovery:', liveResult.reason);
      if (storeResult.status === 'rejected') console.error('CENIQ Latvian store discovery:', storeResult.reason);

      // Keep the hot path bounded. The catalog persists everything, so later searches
      // build on previous coverage instead of replacing it with a random subset.
      const discovered = [...liveCandidates, ...storeCandidates].slice(0, 40);
      if (discovered.length) {
        await ingestCandidates(discovered);
        rawResults = await searchCanonicalCatalog(q);
        results = shapeCanonicalResults(rawResults, q);
        if (results.length) source = storeCandidates.length ? 'canonical-lv-stores' : 'canonical-live';
      }
    }

    const bestCoverage = coverage(results);
    const bestVariants = variantCount(results);

    return NextResponse.json({
      results,
      source,
      cached: source === 'canonical-catalog',
      liveCandidateCount,
      lvStoreCandidateCount,
      discoveryQueries,
      diagnostics: {
        rawProductGroups: rawResults.length,
        productGroups: results.length,
        bestCoverage,
        bestVariants,
        families: results.map((product) => ({
          id: product.id,
          title: product.title,
          stores: product.storesCount,
          variants: product.catalogVariants?.filter((variant) => variant.offerCount > 0).length || 0,
          offers: product.offers?.length || 0,
          hasImage: Boolean(product.image),
          variantAxes: Array.from(new Set((product.catalogVariants || []).flatMap((variant) => Object.keys(variant.attributes || {})))),
        })),
      },
      expansion: { enabled: false, query: q },
      enrichment: { enabled: false, query: q, jobId: null },
      message: !results.length ? 'CENIQ neatrada derigus veikalu piedavajumus siem meklesanas vardiem.' : undefined,
    });
  } catch (error) {
    console.error('CENIQ canonical search:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Meklesana neizdevas.' }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Search polling is not used.' }, { status: 410 });
}
