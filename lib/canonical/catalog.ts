import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { LATVIA_ELECTRONICS_STORES } from '@/lib/store-registry';
import type { CatalogVariantView, OfferView, ProductResult, VariantAttributes } from '@/lib/types';
import {
  applyVariantOutlierValidation,
  chooseImage,
  merchantDomainAllowed,
  normalizeText,
  resolveCandidate,
  selectVariantForQuery,
  scoreExactVariant,
  type NormalizedOfferCandidate,
  type ResolvedCandidate,
} from './domain';
import { canonicalizeMerchantProductTitle } from './title-normalization';

const approvedDomains = new Set(LATVIA_ELECTRONICS_STORES.map((store) => store.domain));
const OFFER_MAX_AGE_MS = Math.max(1, Number(process.env.OFFER_MAX_AGE_HOURS || 48)) * 60 * 60 * 1000;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function slug(value: string) {
  return normalizeText(value).replace(/\s+/g, '-').slice(0, 80) || 'merchant';
}

function normalizedIdentifier(value: string) {
  return normalizeText(value).replace(/\s+/g, '');
}

export function acceptsMerchant(candidate: NormalizedOfferCandidate) {
  return merchantDomainAllowed(candidate.merchant.domain, approvedDomains);
}

async function locateVariant(candidate: ResolvedCandidate) {
  const strong = candidate.identifiers || [];
  for (const identifier of strong) {
    const found = await prisma.variantIdentifier.findFirst({
      where: { type: identifier.type, normalizedValue: normalizedIdentifier(identifier.value) },
      select: { variant: { select: { id: true, familyId: true } } },
    });
    if (found) return found.variant;
  }
  return null;
}

async function ingestOne(candidate: ResolvedCandidate, observe = true) {
  if (!acceptsMerchant(candidate)) return { accepted: false, reason: 'merchant-domain-not-approved' };

  const known = await locateVariant(candidate);
  const family = known
    ? await prisma.productFamily.findUniqueOrThrow({ where: { id: known.familyId } })
    : await prisma.productFamily.upsert({
        where: { canonicalKey: candidate.familyKey },
        create: {
          canonicalKey: candidate.familyKey,
          canonicalTitle: candidate.familyTitle,
          normalizedTitle: candidate.normalizedTitle,
          brand: candidate.brand,
          model: candidate.model,
          category: candidate.category,
        },
        update: {
          canonicalTitle: candidate.familyTitle,
          normalizedTitle: candidate.normalizedTitle,
          brand: candidate.brand || undefined,
          model: candidate.model || undefined,
          category: candidate.category || undefined,
        },
      });

  const attrs = candidate.attributes as VariantAttributes;
  const variant = known
    ? await prisma.productVariant.update({
        where: { id: known.id },
        data: { attributes: json(attrs), ...attrs },
      })
    : await prisma.productVariant.upsert({
        where: { familyId_variantKey: { familyId: family.id, variantKey: candidate.variantKey } },
        create: { familyId: family.id, variantKey: candidate.variantKey, attributes: json(attrs), ...attrs },
        update: { attributes: json(attrs), ...attrs },
      });

  const legacyProducts = await prisma.product.findMany({
    where: { normalizedTitle: candidate.normalizedTitle }, select: { id: true }, take: 20,
  });
  for (const legacy of legacyProducts) {
    await prisma.productAlias.upsert({
      where: { alias: legacy.id }, create: { alias: legacy.id, familyId: family.id },
      update: { familyId: family.id, variantId: null },
    });
  }
  if (legacyProducts.length) {
    const legacyIds = legacyProducts.map((product) => product.id);
    await Promise.all([
      prisma.wishlist.updateMany({ where: { productId: { in: legacyIds }, familyId: null }, data: { familyId: family.id } }),
      prisma.priceAlert.updateMany({ where: { productId: { in: legacyIds }, familyId: null }, data: { familyId: family.id } }),
    ]);
  }

  for (const identifier of candidate.identifiers || []) {
    await prisma.variantIdentifier.upsert({
      where: {
        type_normalizedValue_source: {
          type: identifier.type,
          normalizedValue: normalizedIdentifier(identifier.value),
          source: identifier.source || candidate.source,
        },
      },
      create: {
        variantId: variant.id,
        type: identifier.type,
        value: identifier.value,
        normalizedValue: normalizedIdentifier(identifier.value),
        source: identifier.source || candidate.source,
        confidence: identifier.confidence ?? candidate.confidence,
      },
      update: { variantId: variant.id, confidence: identifier.confidence ?? candidate.confidence },
    });
  }

  if (candidate.image?.url && candidate.image.provenance === 'family') {
    await prisma.productFamily.update({
      where: { id: family.id },
      data: { familyImageUrl: candidate.image.url, familyImageSource: candidate.image.source, familyImageConfidence: candidate.image.confidence },
    });
  } else if (candidate.image?.url) {
    await prisma.variantImage.upsert({
      where: { variantId_url: { variantId: variant.id, url: candidate.image.url } },
      create: { variantId: variant.id, ...candidate.image, lastVerifiedAt: new Date() },
      update: { source: candidate.image.source, provenance: candidate.image.provenance, confidence: candidate.image.confidence, lastVerifiedAt: new Date() },
    });
  }

  const merchantSlug = candidate.merchant.slug || slug(candidate.merchant.domain || candidate.merchant.name);
  const merchant = await prisma.merchant.upsert({
    where: { slug: merchantSlug },
    create: { slug: merchantSlug, name: candidate.merchant.name, domain: candidate.merchant.domain },
    update: { name: candidate.merchant.name, domain: candidate.merchant.domain, active: true },
  });
  let validationStatus = candidate.validationStatus;
  let rejectionReason = candidate.rejectionReason;
  if (validationStatus === 'ACCEPTED' && candidate.totalPrice) {
    const peers = (await prisma.merchantOffer.findMany({
      where: { variantId: variant.id, validationStatus: 'ACCEPTED', priceKind: 'ONE_TIME', totalPrice: { not: null } },
      select: { totalPrice: true }, orderBy: { totalPrice: 'asc' },
    })).map((offer) => offer.totalPrice!).sort((a, b) => a - b);
    if (peers.length >= 3) {
      const middle = Math.floor(peers.length / 2);
      const median = peers.length % 2 ? peers[middle] : (peers[middle - 1] + peers[middle]) / 2;
      if (median >= 100 && candidate.totalPrice < median * 0.38) {
        validationStatus = 'QUARANTINED';
        rejectionReason = 'extreme-low-outlier';
      }
    }
  }
  const accepted = validationStatus === 'ACCEPTED' && candidate.priceKind === 'ONE_TIME';
  const now = new Date();
  const offer = await prisma.merchantOffer.upsert({
    where: { merchantId_sourceKey: { merchantId: merchant.id, sourceKey: candidate.sourceKey } },
    create: {
      variantId: variant.id, merchantId: merchant.id, sourceType: candidate.source, sourceKey: candidate.sourceKey,
      url: candidate.url, imageUrl: candidate.image?.url, oneTimePrice: accepted ? candidate.price : null,
      shippingPrice: accepted ? candidate.shippingPrice : null, totalPrice: accepted ? candidate.totalPrice : null,
      currency: candidate.currency || 'EUR', priceKind: candidate.priceKind, availability: candidate.availability,
      stockQty: candidate.stockQty, validationStatus, rejectionReason,
      confidence: candidate.confidence, lastSeenAt: now, expiresAt: new Date(now.getTime() + OFFER_MAX_AGE_MS),
    },
    update: {
      variantId: variant.id, url: candidate.url, imageUrl: candidate.image?.url,
      oneTimePrice: accepted ? candidate.price : null, shippingPrice: accepted ? candidate.shippingPrice : null,
      totalPrice: accepted ? candidate.totalPrice : null, currency: candidate.currency || 'EUR', priceKind: candidate.priceKind,
      availability: candidate.availability, stockQty: candidate.stockQty, validationStatus,
      rejectionReason, confidence: candidate.confidence, lastSeenAt: now,
      expiresAt: new Date(now.getTime() + OFFER_MAX_AGE_MS),
    },
  });
  if (observe) {
    await prisma.offerObservation.create({
      data: {
        offerId: offer.id, oneTimePrice: accepted ? candidate.price : null,
        shippingPrice: accepted ? candidate.shippingPrice : null, totalPrice: accepted ? candidate.totalPrice : null,
        priceKind: candidate.priceKind, availability: candidate.availability,
      },
    });
  }
  return { accepted, familyId: family.id, variantId: variant.id, offerId: offer.id };
}

export async function ingestCandidates(candidates: NormalizedOfferCandidate[], options: { observe?: boolean } = {}) {
  const resolved = applyVariantOutlierValidation(candidates.map(resolveCandidate));
  const results = [];
  for (const candidate of resolved) results.push(await ingestOne(candidate, options.observe !== false));
  return results;
}

export async function recanonicalizeExistingOffers(query: string) {
  const normalized = normalizeText(query);
  const first = normalized.split(' ').filter(Boolean)[0];
  if (!first) return 0;
  const freshAfter = new Date(Date.now() - OFFER_MAX_AGE_MS);

  const families = await prisma.productFamily.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        { normalizedTitle: { contains: first, mode: 'insensitive' } },
        { brand: { contains: first, mode: 'insensitive' } },
        { model: { contains: first, mode: 'insensitive' } },
      ],
    },
    include: {
      variants: {
        where: { status: 'ACTIVE' },
        include: {
          images: { orderBy: { confidence: 'desc' }, take: 1 },
          offers: {
            where: {
              validationStatus: 'ACCEPTED',
              priceKind: 'ONE_TIME',
              oneTimePrice: { not: null },
              totalPrice: { not: null },
              lastSeenAt: { gte: freshAfter },
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            include: { merchant: true },
          },
        },
      },
    },
    take: 50,
  });

  const candidates: NormalizedOfferCandidate[] = [];
  for (const family of families) {
    const identity = canonicalizeMerchantProductTitle(family.canonicalTitle, family.brand || undefined);
    if (normalizeText(identity.title) === normalizeText(family.canonicalTitle) && identity.brand === (family.brand || undefined)) {
      continue;
    }

    for (const variant of family.variants) {
      const attrs = variant.attributes as VariantAttributes;
      const variantImage = variant.images[0]?.url;
      for (const offer of variant.offers) {
        const merchantDomain = offer.merchant.domain || '';
        if (!merchantDomain || offer.oneTimePrice == null) continue;
        candidates.push({
          source: offer.sourceType,
          sourceKey: offer.sourceKey,
          merchant: {
            name: offer.merchant.name,
            domain: merchantDomain,
            slug: offer.merchant.slug,
          },
          title: identity.title,
          brand: identity.brand,
          model: family.model || undefined,
          category: family.category || undefined,
          url: offer.url,
          image: (offer.imageUrl || variantImage)
            ? {
                url: offer.imageUrl || variantImage!,
                source: 'canonical-repair',
                provenance: 'variant',
                confidence: 0.8,
              }
            : undefined,
          attributes: attrs,
          price: offer.oneTimePrice,
          shippingPrice: offer.shippingPrice || undefined,
          currency: offer.currency,
          availability: offer.availability || undefined,
          stockQty: offer.stockQty || undefined,
          evidence: {
            displayedPrice: `${offer.oneTimePrice} ${offer.currency}`,
            sellerText: offer.merchant.name,
            explicitOneTime: true,
          },
        });
      }
    }
  }

  if (!candidates.length) return 0;
  await ingestCandidates(candidates, { observe: false });
  return candidates.length;
}

type FamilyRow = Awaited<ReturnType<typeof loadFamilies>>[number];

async function loadFamilies(ids?: string[]) {
  const freshAfter = new Date(Date.now() - OFFER_MAX_AGE_MS);
  return prisma.productFamily.findMany({
    where: { status: 'ACTIVE', ...(ids ? { id: { in: ids } } : {}) },
    include: {
      variants: {
        where: { status: 'ACTIVE' },
        include: {
          images: true,
          offers: {
            where: {
              validationStatus: 'ACCEPTED', priceKind: 'ONE_TIME', totalPrice: { not: null },
              lastSeenAt: { gte: freshAfter }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            include: { merchant: true },
          },
        },
      },
    },
  });
}

function queryMatches(family: FamilyRow, query: string) {
  const variantText = family.variants.map((variant) => Object.values(variant.attributes as Record<string, string>).join(' ')).join(' ');
  const haystack = normalizeText(`${family.canonicalTitle} ${family.brand || ''} ${family.model || ''} ${variantText}`);
  return normalizeText(query).split(' ').filter(Boolean).every((token) => haystack.includes(token));
}

function familyToResult(family: FamilyRow, query = '', preferredVariantId?: string): ProductResult | null {
  const variants = family.variants;
  const offeredVariants = variants.filter((variant) => variant.offers.length);
  if (!offeredVariants.length) return null;
  const selectable = variants.map((variant) => ({
    ...variant, attributes: variant.attributes as VariantAttributes, offerCount: variant.offers.length,
    bestPrice: variant.offers.length ? Math.min(...variant.offers.map((offer) => offer.totalPrice!)) : undefined,
  }));
  const offeredSelectable = selectable.filter((variant) => variant.offerCount > 0);
  const selected =
    offeredSelectable.find((variant) => variant.id === preferredVariantId) ||
    selectVariantForQuery(offeredSelectable, query) ||
    offeredSelectable[0];

  const views: OfferView[] = [];
  for (const variant of offeredVariants) {
    const scored = scoreExactVariant(variant.offers.map((offer) => ({
      offer, merchantKey: offer.merchant.domain || offer.merchant.slug, totalPrice: offer.totalPrice!,
      trust: offer.merchant.trustScore || undefined, available: !/out.of.stock/i.test(offer.availability || ''),
      confidence: offer.confidence, fresh: true,
    })));
    const min = Math.min(...scored.map((item) => item.totalPrice));
    const best = [...scored].sort((a, b) => b.score - a.score || a.totalPrice - b.totalPrice)[0];
    for (const item of scored) {
      const offer = item.offer;
      views.push({
        id: offer.id, variantId: variant.id, merchant: offer.merchant.name, merchantDomain: offer.merchant.domain || undefined,
        variantLabel: Object.values(variant.attributes as Record<string, string>).filter((value) => value && value !== 'New').join(' · '),
        variantData: variant.attributes as VariantAttributes,
        image: chooseImage(variant.images.map((image) => ({ ...image, provenance: image.provenance as 'variant' | 'offer' | 'family' })), offer.imageUrl || undefined),
        price: offer.oneTimePrice!, shipping: offer.shippingPrice || 0, shippingKnown: offer.shippingPrice != null,
        totalPrice: offer.totalPrice!, currency: offer.currency, dealScore: item.score,
        deliveryMessage: offer.availability || undefined, url: offer.url,
        isCheapest: offer.totalPrice === min, isBestOverall: offer.id === best.offer.id,
      });
    }
  }
  const catalogVariants: CatalogVariantView[] = variants.map((variant) => ({
    id: variant.id, variantKey: variant.variantKey, attributes: variant.attributes as VariantAttributes,
    image: chooseImage(variant.images.map((image) => ({ ...image, provenance: image.provenance as 'variant' | 'offer' | 'family' })), variant.offers.find((offer) => offer.imageUrl)?.imageUrl || undefined),
    offerCount: variant.offers.length, bestPrice: variant.offers.length ? Math.min(...variant.offers.map((offer) => offer.totalPrice!)) : undefined,
  }));
  const selectedOffers = views.filter((offer) => offer.variantId === selected.id);
  const bestPrice = selectedOffers.length ? Math.min(...selectedOffers.map((offer) => offer.totalPrice)) : 0;
  return {
    id: family.id, externalId: `family:${family.id}`, title: family.canonicalTitle,
    normalizedTitle: family.normalizedTitle, brand: family.brand || undefined, category: family.category || undefined,
    image: catalogVariants.find((variant) => variant.id === selected.id)?.image || family.familyImageUrl || undefined,
    familyImage: family.familyImageUrl || undefined,
    bestPrice, currency: selectedOffers[0]?.currency || 'EUR',
    dealScore: Math.max(0, ...selectedOffers.map((offer) => offer.dealScore)), offers: views,
    storesCount: new Set(selectedOffers.map((offer) => offer.merchantDomain || offer.merchant)).size,
    variants: catalogVariants.map((variant) => Object.values(variant.attributes).filter((value) => value && value !== 'New').join(' · ')),
    catalogVariants, selectedVariantId: selected.id,
  };
}

export async function searchCanonicalCatalog(query: string) {
  const normalized = normalizeText(query);
  const first = normalized.split(' ').filter(Boolean)[0];
  if (!first) return [];
  const candidates = await prisma.productFamily.findMany({
    where: { status: 'ACTIVE', OR: [{ normalizedTitle: { contains: first, mode: 'insensitive' } }, { brand: { contains: first, mode: 'insensitive' } }, { model: { contains: first, mode: 'insensitive' } }] },
    select: { id: true }, take: 30,
  });
  const families = await loadFamilies(candidates.map((row) => row.id));
  return families.filter((family) => queryMatches(family, query)).map((family) => familyToResult(family, query)).filter(Boolean) as ProductResult[];
}

export async function getCanonicalProduct(id: string, preferredVariantId?: string) {
  let familyId = id;
  const alias = await prisma.productAlias.findUnique({ where: { alias: id } });
  if (alias) familyId = alias.familyId;
  const family = (await loadFamilies([familyId]))[0];
  if (!family) return null;
  return familyToResult(family, '', preferredVariantId);
}
