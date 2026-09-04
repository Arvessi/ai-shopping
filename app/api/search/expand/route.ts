import { NextResponse } from 'next/server';
import { databaseConfigured } from '@/lib/db';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import { getCanonicalProduct, ingestCandidates, searchCanonicalCatalog } from '@/lib/canonical/catalog';
import { discoverShoppingLiveMany, mapShoppingCandidates } from '@/lib/canonical/dataforseo-client';
import { discoverLatvianStoreCandidates } from '@/lib/canonical/store-discovery';
import { expandDiscoveryQueries } from '@/lib/canonical/query-expansion';
import { shapeCanonicalResults } from '@/lib/canonical/result-shaping';
import { canonicalizeMerchantProductTitle } from '@/lib/canonical/title-normalization';
import { normalizeText } from '@/lib/canonical/domain';
import type { ProductResult } from '@/lib/types';

export const maxDuration = 45;

function coverage(results: ProductResult[]) {
  return Math.max(0, ...results.map((product) => product.storesCount || 0));
}

function variantCount(results: ProductResult[]) {
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

async function loadDiscoveredFamilies(ingestResults: Awaited<ReturnType<typeof ingestCandidates>>) {
  const familyIds = Array.from(
    new Set(
      ingestResults
        .filter((row) => row.accepted && row.familyId)
        .map((row) => String(row.familyId)),
    ),
  );

  const products = await Promise.all(familyIds.slice(0, 60).map((familyId) => getCanonicalProduct(familyId)));
  return products.filter((product): product is ProductResult => Boolean(product));
}

function mergeProducts(...groups: ProductResult[][]) {
  const byId = new Map<string, ProductResult>();
  for (const group of groups) {
    for (const product of group) {
      const existing = byId.get(product.id);
      if (!existing || (product.offers?.length || 0) > (existing.offers?.length || 0)) {
        byId.set(product.id, product);
      }
    }
  }
  return Array.from(byId.values());
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

    const discovered = [...storeCandidates, ...liveCandidates].slice(0, 140);
    const ingestResults = discovered.length ? await ingestCandidates(discovered) : [];

    // Do not rely only on searchCanonicalCatalog finding the new family by query tokens.
    // For broad/generic searches the merchant title may not literally contain words like
    // "laptop" or "headphones". Families created by this discovery request are relevant
    // evidence and must be eligible for the response immediately.
    const [catalogMatches, freshlyDiscovered] = await Promise.all([
      searchCatalogWithFallback(q),
      loadDiscoveredFamilies(ingestResults),
    ]);

    const rawResults = mergeProducts(catalogMatches, freshlyDiscovered);
    const results = shapeCanonicalResults(rawResults, q);

    const acceptedWrites = ingestResults.filter((row) => row.accepted).length;
    const rejectedWrites = ingestResults.length - acceptedWrites;

    return NextResponse.json({
      results,
      source: storeCandidates.length ? 'canonical-expanded-stores' : 'canonical-expanded-live',
      discoveryQueries,
      liveCandidateCount: liveCandidates.length,
      lvStoreCandidateCount: storeCandidates.length,
      acceptedWrites,
      rejectedWrites,
      discoveredFamilies: freshlyDiscovered.length,
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
