import { NextResponse } from 'next/server';
import { databaseConfigured, prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!databaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Database is not configured.' }, { status: 503 });
  }

  const now = new Date();
  const acceptedWhere = {
    validationStatus: 'ACCEPTED' as const,
    priceKind: 'ONE_TIME' as const,
    totalPrice: { not: null },
  };
  const freshWhere = {
    ...acceptedWhere,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };

  const [families, variants, merchants, acceptedOffers, freshOffers, v2AcceptedOffers, v2FreshOffers, sourceGroups, merchantGroups] = await Promise.all([
    prisma.productFamily.count({ where: { status: 'ACTIVE' } }),
    prisma.productVariant.count({ where: { status: 'ACTIVE' } }),
    prisma.merchant.count({ where: { active: true } }),
    prisma.merchantOffer.count({ where: acceptedWhere }),
    prisma.merchantOffer.count({ where: freshWhere }),
    prisma.merchantOffer.count({ where: { ...acceptedWhere, sourceType: 'collector-v2' } }),
    prisma.merchantOffer.count({ where: { ...freshWhere, sourceType: 'collector-v2' } }),
    prisma.merchantOffer.groupBy({
      by: ['sourceType'],
      where: freshWhere,
      _count: { _all: true },
      _max: { lastSeenAt: true },
      orderBy: { _count: { sourceType: 'desc' } },
    }),
    prisma.merchantOffer.groupBy({
      by: ['merchantId'],
      where: { ...freshWhere, sourceType: 'collector-v2' },
      _count: { _all: true },
      _max: { lastSeenAt: true },
      orderBy: { _count: { merchantId: 'desc' } },
    }),
  ]);

  const merchantRows = merchantGroups.length
    ? await prisma.merchant.findMany({
        where: { id: { in: merchantGroups.map((group) => group.merchantId) } },
        select: { id: true, slug: true, name: true, domain: true },
      })
    : [];
  const merchantById = new Map(merchantRows.map((merchant) => [merchant.id, merchant]));

  const recent = await prisma.merchantOffer.findMany({
    where: { ...acceptedWhere, sourceType: 'collector-v2' },
    orderBy: { lastSeenAt: 'desc' },
    take: 12,
    select: {
      id: true,
      totalPrice: true,
      currency: true,
      lastSeenAt: true,
      sourceType: true,
      merchant: { select: { slug: true, name: true } },
      variant: { select: { family: { select: { canonicalTitle: true } } } },
    },
  });

  return NextResponse.json({
    ok: true,
    counts: {
      families,
      variants,
      merchants,
      acceptedOffers,
      freshOffers,
      v2AcceptedOffers,
      v2FreshOffers,
      legacyFreshOffers: Math.max(0, freshOffers - v2FreshOffers),
      v2MerchantsWithFreshOffers: merchantGroups.length,
    },
    sources: sourceGroups.map((group) => ({
      sourceType: group.sourceType,
      freshOffers: group._count._all,
      lastSeenAt: group._max.lastSeenAt,
    })),
    v2ByMerchant: merchantGroups.map((group) => {
      const merchant = merchantById.get(group.merchantId);
      return {
        merchant: merchant?.name || group.merchantId,
        merchantSlug: merchant?.slug,
        domain: merchant?.domain,
        freshOffers: group._count._all,
        lastSeenAt: group._max.lastSeenAt,
      };
    }),
    recent: recent.map((offer) => ({
      title: offer.variant.family.canonicalTitle,
      merchant: offer.merchant.name,
      merchantSlug: offer.merchant.slug,
      totalPrice: offer.totalPrice,
      currency: offer.currency,
      sourceType: offer.sourceType,
      lastSeenAt: offer.lastSeenAt,
    })),
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
