import { databaseConfigured, prisma } from './db';
import type { OfferView, ProductResult } from './types';

export async function persistProducts(products: ProductResult[]) {
  if (!databaseConfigured()) return products;
  const saved: ProductResult[] = [];
  for (const product of products) {
    try {
      const dbProduct = await prisma.product.upsert({
        where: { externalId: product.externalId },
        create: {
          externalId: product.externalId,
          gid: product.gid,
          dataDocId: product.dataDocId,
          title: product.title,
          normalizedTitle: product.normalizedTitle,
          brand: product.brand,
          category: product.category,
          description: product.description,
          image: product.image,
          currency: product.currency,
          currentBestPrice: product.bestPrice,
          dealScore: product.dealScore,
          lastSyncedAt: new Date(),
        },
        update: {
          gid: product.gid,
          dataDocId: product.dataDocId,
          title: product.title,
          normalizedTitle: product.normalizedTitle,
          brand: product.brand,
          category: product.category,
          description: product.description,
          image: product.image,
          currency: product.currency,
          currentBestPrice: product.bestPrice,
          dealScore: product.dealScore,
          lastSyncedAt: new Date(),
        },
      });

      await prisma.offer.deleteMany({ where: { productId: dbProduct.id } });
      if (product.offers.length) {
        await prisma.offer.createMany({
          data: product.offers.map((o) => ({
            productId: dbProduct.id,
            merchant: o.merchant,
            merchantDomain: o.merchantDomain,
            price: o.price,
            shipping: o.shipping,
            totalPrice: o.totalPrice,
            currency: o.currency,
            sellerRating: o.sellerRating,
            sellerVotes: o.sellerVotes,
            deliveryMessage: o.deliveryMessage,
            rawUrl: o.url,
            dealScore: o.dealScore,
            isCheapest: o.isCheapest,
            isBestOverall: o.isBestOverall,
          })),
        });
      }
      await prisma.priceSnapshot.create({ data: { productId: dbProduct.id, price: product.bestPrice, currency: product.currency } });
      const offers = await prisma.offer.findMany({ where: { productId: dbProduct.id }, orderBy: { totalPrice: 'asc' } });
      saved.push({
        ...product,
        id: dbProduct.id,
        offers: offers.map((o: any) => ({
          id: o.id,
          merchant: o.merchant,
          merchantDomain: o.merchantDomain || undefined,
          price: o.price,
          shipping: o.shipping,
          totalPrice: o.totalPrice,
          currency: o.currency,
          sellerRating: o.sellerRating || undefined,
          sellerVotes: o.sellerVotes || undefined,
          deliveryMessage: o.deliveryMessage || undefined,
          url: o.rawUrl || undefined,
          dealScore: o.dealScore,
          isCheapest: o.isCheapest,
          isBestOverall: o.isBestOverall,
        })),
      });
    } catch (error) {
      console.error('persistProducts:', error);
      saved.push(product);
    }
  }
  return saved;
}

export async function replaceOffers(productId: string, offers: OfferView[]) {
  if (!databaseConfigured()) return;
  const bestPrice = offers.length ? Math.min(...offers.map((o) => o.totalPrice)) : undefined;
  const productScore = offers.length
    ? Math.max(...offers.map((o) => o.dealScore))
    : 50;

  await prisma.$transaction([
    prisma.offer.deleteMany({ where: { productId } }),
    ...(offers.length ? [prisma.offer.createMany({ data: offers.map((o) => ({
      productId,
      merchant: o.merchant,
      merchantDomain: o.merchantDomain,
      price: o.price,
      shipping: o.shipping,
      totalPrice: o.totalPrice,
      currency: o.currency,
      sellerRating: o.sellerRating,
      sellerVotes: o.sellerVotes,
      deliveryMessage: o.deliveryMessage,
      rawUrl: o.url,
      dealScore: o.dealScore,
      isCheapest: o.isCheapest,
      isBestOverall: o.isBestOverall,
    })) })] : []),
    prisma.product.update({ where: { id: productId }, data: { currentBestPrice: bestPrice, dealScore: offers.find((o) => o.isBestOverall)?.dealScore || productScore, lastSyncedAt: new Date() } }),
    ...(bestPrice !== undefined ? [prisma.priceSnapshot.create({ data: { productId, price: bestPrice, currency: offers[0]?.currency || 'EUR' } })] : []),
  ]);
}
