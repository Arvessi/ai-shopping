import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { LATVIA_ELECTRONICS_STORES } from '@/lib/store-registry';

export async function GET() {
  const feeds = await prisma.feedSource.findMany({
    where: {
      format: 'adapter',
    },
    include: {
      merchant: true,
      offers: {
        where: { active: true },
        select: {
          id: true,
          variantId: true,
          updatedAt: true,
        },
      },
    },
    orderBy: {
      merchant: {
        name: 'asc',
      },
    },
  });

  const bySlug = new Map<
    string,
    { offers: number; variants: number; lastUpdatedAt: Date | null }
  >(
    feeds.map(
      (feed: {
        merchant: { slug: string };
        offers: Array<{ variantId: string; updatedAt: Date }>;
      }) => [
        feed.merchant.slug,
        {
          offers: feed.offers.length,
          variants: new Set(
            feed.offers.map(
              (offer: { variantId: string }) => offer.variantId,
            ),
          ).size,
          lastUpdatedAt:
            feed.offers
              .map(
                (offer: { updatedAt: Date }) => offer.updatedAt,
              )
              .sort(
                (a: Date, b: Date) => b.getTime() - a.getTime(),
              )[0] || null,
        },
      ],
    ),
  );

  const stores = LATVIA_ELECTRONICS_STORES.map((store) => ({
    slug: store.slug,
    name: store.name,
    domain: store.domain,
    ...(bySlug.get(store.slug) || {
      offers: 0,
      variants: 0,
      lastUpdatedAt: null,
    }),
  }));

  return NextResponse.json({
    engine: 'ceniq-store-adapters-v34',
    configuredStores: LATVIA_ELECTRONICS_STORES.length,
    activeAdapterStores: stores.filter((store) => store.offers > 0).length,
    totalOffers: stores.reduce((sum, store) => sum + store.offers, 0),
    totalVariants: stores.reduce((sum, store) => sum + store.variants, 0),
    stores,
  });
}
