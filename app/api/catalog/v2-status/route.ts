import { NextResponse } from 'next/server';
import { databaseConfigured, prisma } from '@/lib/db';

export async function GET() {
  if (!databaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Database is not configured.' }, { status: 503 });
  }

  const now = new Date();
  const [families, variants, merchants, acceptedOffers, freshOffers] = await Promise.all([
    prisma.productFamily.count({ where: { status: 'ACTIVE' } }),
    prisma.productVariant.count({ where: { status: 'ACTIVE' } }),
    prisma.merchant.count({ where: { active: true } }),
    prisma.merchantOffer.count({
      where: { validationStatus: 'ACCEPTED', priceKind: 'ONE_TIME', totalPrice: { not: null } },
    }),
    prisma.merchantOffer.count({
      where: {
        validationStatus: 'ACCEPTED',
        priceKind: 'ONE_TIME',
        totalPrice: { not: null },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
  ]);

  const recent = await prisma.merchantOffer.findMany({
    where: { validationStatus: 'ACCEPTED', priceKind: 'ONE_TIME', totalPrice: { not: null } },
    orderBy: { lastSeenAt: 'desc' },
    take: 8,
    select: {
      id: true,
      totalPrice: true,
      currency: true,
      lastSeenAt: true,
      merchant: { select: { slug: true, name: true } },
      variant: { select: { family: { select: { canonicalTitle: true } } } },
    },
  });

  return NextResponse.json({
    ok: true,
    counts: { families, variants, merchants, acceptedOffers, freshOffers },
    recent: recent.map((offer) => ({
      title: offer.variant.family.canonicalTitle,
      merchant: offer.merchant.name,
      merchantSlug: offer.merchant.slug,
      totalPrice: offer.totalPrice,
      currency: offer.currency,
      lastSeenAt: offer.lastSeenAt,
    })),
  });
}
