import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  const products = await prisma.product.findMany({
    where: {
      source: 'merchant-engine',
    },
    include: {
      offers: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: 200,
  });

  const merchants = new Map<string, number>();
  const variants = new Set<string>();

  for (const product of products) {
    for (const offer of product.offers) {
      const merchant = (
        offer.merchantDomain ||
        offer.merchant
      )
        .toLowerCase()
        .replace(/^www\./, '');

      merchants.set(
        merchant,
        (merchants.get(merchant) || 0) + 1,
      );

      const variant = JSON.stringify(
        offer.variantData || {},
      );

      variants.add(
        `${product.id}:${variant}`,
      );
    }
  }

  return NextResponse.json({
    engine: 'ceniq-google-merchant-v35',
    products: products.length,
    offers: products.reduce(
      (sum, product) => sum + product.offers.length,
      0,
    ),
    variants: variants.size,
    merchants: Array.from(merchants.entries())
      .map(([merchant, offers]) => ({
        merchant,
        offers,
      }))
      .sort((a, b) => b.offers - a.offers),
    recentProducts: products.slice(0, 20).map((product) => ({
      title: product.title,
      stores: new Set(
        product.offers.map(
          (offer) =>
            offer.merchantDomain ||
            offer.merchant,
        ),
      ).size,
      variants: new Set(
        product.offers.map((offer) =>
          JSON.stringify(offer.variantData || {}),
        ),
      ).size,
      updatedAt: product.updatedAt,
    })),
  });
}
