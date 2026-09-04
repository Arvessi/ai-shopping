import { NextResponse } from 'next/server';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import { acceptsMerchant, searchCanonicalCatalog } from '@/lib/canonical/catalog';
import { resolveCandidate } from '@/lib/canonical/domain';
import {
  discoverShoppingLiveMany,
  mapShoppingCandidates,
} from '@/lib/canonical/dataforseo-client';
import { discoverLatvianStoreCandidates } from '@/lib/canonical/store-discovery';
import { expandDiscoveryQueries } from '@/lib/canonical/query-expansion';
import { shapeCanonicalResults } from '@/lib/canonical/result-shaping';

export const maxDuration = 45;

function compactCandidate(candidate: ReturnType<typeof resolveCandidate>) {
  return {
    source: candidate.source,
    merchant: candidate.merchant.name,
    merchantDomain: candidate.merchant.domain,
    title: candidate.title,
    familyTitle: candidate.familyTitle,
    familyKey: candidate.familyKey,
    variantKey: candidate.variantKey,
    attributes: candidate.attributes,
    price: candidate.price,
    totalPrice: candidate.totalPrice,
    currency: candidate.currency || 'EUR',
    priceKind: candidate.priceKind,
    validationStatus: candidate.validationStatus,
    rejectionReason: candidate.rejectionReason,
    merchantAllowed: acceptsMerchant(candidate),
    image: candidate.image?.url,
    url: candidate.url,
    identifiers: candidate.identifiers || [],
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = String(url.searchParams.get('q') || '').trim();

  if (!q) {
    return NextResponse.json({ error: 'Missing q query parameter.' }, { status: 400 });
  }

  if (isRestrictedShoppingQuery(q)) {
    return NextResponse.json({ error: 'Ceniq so produktu kategoriju nemekle.' }, { status: 400 });
  }

  const startedAt = Date.now();
  const discoveryQueries = expandDiscoveryQueries(q);
  const beforeRaw = await searchCanonicalCatalog(q).catch(() => []);
  const before = shapeCanonicalResults(beforeRaw, q);

  const [liveResult, storeResult] = await Promise.allSettled([
    discoverShoppingLiveMany(discoveryQueries).then(mapShoppingCandidates),
    discoverLatvianStoreCandidates(q),
  ]);

  const liveCandidates = liveResult.status === 'fulfilled' ? liveResult.value : [];
  const storeCandidates = storeResult.status === 'fulfilled' ? storeResult.value : [];
  const resolved = [...liveCandidates, ...storeCandidates].map(resolveCandidate);

  const candidateSummary = {
    total: resolved.length,
    accepted: resolved.filter((candidate) => candidate.validationStatus === 'ACCEPTED' && acceptsMerchant(candidate)).length,
    rejected: resolved.filter((candidate) => candidate.validationStatus !== 'ACCEPTED' || !acceptsMerchant(candidate)).length,
    withImage: resolved.filter((candidate) => Boolean(candidate.image?.url)).length,
    withStorage: resolved.filter((candidate) => Boolean(candidate.attributes.storage)).length,
    uniqueMerchants: Array.from(new Set(resolved.map((candidate) => candidate.merchant.domain))).filter(Boolean),
    uniqueFamilies: Array.from(new Set(resolved.map((candidate) => candidate.familyKey))),
  };

  const familiesBefore = before.map((product) => ({
    id: product.id,
    title: product.title,
    storesCount: product.storesCount,
    variants: product.catalogVariants?.map((variant) => ({
      id: variant.id,
      attributes: variant.attributes,
      offerCount: variant.offerCount,
      bestPrice: variant.bestPrice,
      image: variant.image,
    })),
    offers: product.offers?.map((offer) => ({
      merchant: offer.merchant,
      merchantDomain: offer.merchantDomain,
      variantId: offer.variantId,
      variantData: offer.variantData,
      totalPrice: offer.totalPrice,
      dealScore: offer.dealScore,
      image: offer.image,
      url: offer.url,
    })),
  }));

  return NextResponse.json({
    query: q,
    discoveryQueries,
    durationMs: Date.now() - startedAt,
    providerStatus: {
      live: liveResult.status === 'fulfilled'
        ? { ok: true, count: liveCandidates.length }
        : { ok: false, error: liveResult.reason instanceof Error ? liveResult.reason.message : String(liveResult.reason) },
      lvStores: storeResult.status === 'fulfilled'
        ? { ok: true, count: storeCandidates.length }
        : { ok: false, error: storeResult.reason instanceof Error ? storeResult.reason.message : String(storeResult.reason) },
    },
    catalogBefore: {
      rawFamilyCount: beforeRaw.length,
      familyCount: familiesBefore.length,
      families: familiesBefore,
    },
    candidateSummary,
    candidates: resolved.map(compactCandidate),
  });
}
