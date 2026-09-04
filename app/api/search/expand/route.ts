import { NextResponse } from 'next/server';
import { databaseConfigured } from '@/lib/db';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import { ingestCandidates, searchCanonicalCatalog } from '@/lib/canonical/catalog';
import { discoverShoppingLiveMany, mapShoppingCandidates } from '@/lib/canonical/dataforseo-client';
import { discoverLatvianStoreCandidates } from '@/lib/canonical/store-discovery';
import { expandDiscoveryQueries } from '@/lib/canonical/query-expansion';
import { shapeCanonicalResults } from '@/lib/canonical/result-shaping';

export const maxDuration = 30;

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
    if (!databaseConfigured()) return NextResponse.json({ error: 'Datubāze nav konfigurēta.' }, { status: 503 });

    const body = await request.json();
    const q = String(body?.q || '').trim();
    if (!q || isRestrictedShoppingQuery(q)) {
      return NextResponse.json({ error: 'Nederīga meklēšanas frāze.' }, { status: 400 });
    }

    const discoveryQueries = expandDiscoveryQueries(q);
    const [liveResult, storeResult] = await Promise.allSettled([
      discoverShoppingLiveMany(discoveryQueries).then(mapShoppingCandidates),
      discoverLatvianStoreCandidates(q),
    ]);

    const liveCandidates = liveResult.status === 'fulfilled' ? liveResult.value : [];
    const storeCandidates = storeResult.status === 'fulfilled' ? storeResult.value : [];

    if (liveResult.status === 'rejected') console.error('CENIQ expansion live:', liveResult.reason);
    if (storeResult.status === 'rejected') console.error('CENIQ expansion stores:', storeResult.reason);

    // Prefer direct Latvian-store evidence, then fill gaps with live Shopping results.
    // Keep the write set bounded so expansion cannot time out on DB upserts.
    const discovered = [...storeCandidates, ...liveCandidates].slice(0, 100);
    if (discovered.length) await ingestCandidates(discovered);

    const rawResults = await searchCanonicalCatalog(q);
    const results = shapeCanonicalResults(rawResults, q);

    return NextResponse.json({
      results,
      source: storeCandidates.length ? 'canonical-expanded-stores' : 'canonical-expanded-live',
      discoveryQueries,
      liveCandidateCount: liveCandidates.length,
      lvStoreCandidateCount: storeCandidates.length,
      diagnostics: {
        rawProductGroups: rawResults.length,
        productGroups: results.length,
        bestCoverage: coverage(results),
        bestVariants: variantCount(results),
        families: results.map((product) => ({
          title: product.title,
          stores: product.storesCount || 0,
          variants: product.catalogVariants?.filter((variant) => variant.offerCount > 0).length || 0,
          offers: product.offers?.length || 0,
          variantAxes: Array.from(
            new Set(
              (product.catalogVariants || []).flatMap((variant) => Object.keys(variant.attributes || {})),
            ),
          ),
        })),
      },
    });
  } catch (error) {
    console.error('CENIQ search expansion:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Meklēšanas paplašināšana neizdevās.' },
      { status: 502 },
    );
  }
}
