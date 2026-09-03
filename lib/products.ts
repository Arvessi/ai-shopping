import {
  databaseConfigured,
  prisma,
} from './db';
import type {
  OfferView,
  ProductResult,
  VariantAttributes,
} from './types';

function variantJson(
  value?: VariantAttributes,
) {
  if (!value) return undefined;

  return JSON.parse(
    JSON.stringify(value),
  );
}

export async function persistProducts(
  products: ProductResult[],
) {
  if (!databaseConfigured()) {
    return products;
  }

  const saved: ProductResult[] = [];

  for (const product of products) {
    try {
      const dbProduct =
        await prisma.product.upsert({
          where: {
            externalId:
              product.externalId,
          },
          create: {
            externalId:
              product.externalId,
            sourceProductId:
              product.sourceProductId,
            gid: product.gid,
            dataDocId:
              product.dataDocId,
            title: product.title,
            normalizedTitle:
              product.normalizedTitle,
            brand: product.brand,
            category:
              product.category,
            description:
              product.description,
            image: product.image,
            currency:
              product.currency,
            currentBestPrice:
              product.bestPrice,
            dealScore:
              product.dealScore,
            lastSyncedAt:
              new Date(),
          },
          update: {
            sourceProductId:
              product.sourceProductId ||
              undefined,
            gid:
              product.gid ||
              undefined,
            dataDocId:
              product.dataDocId ||
              undefined,
            title: product.title,
            normalizedTitle:
              product.normalizedTitle,
            brand: product.brand,
            category:
              product.category,
            description:
              product.description,
            image:
              product.image ||
              undefined,
            currency:
              product.currency,
            currentBestPrice:
              product.bestPrice,
            dealScore:
              product.dealScore,
            lastSyncedAt:
              new Date(),
          },
        });

      await prisma.offer.deleteMany({
        where: {
          productId:
            dbProduct.id,
        },
      });

      if (
        product.offers.length
      ) {
        await prisma.offer.createMany({
          data: product.offers.map(
            (offer) => ({
              productId:
                dbProduct.id,
              merchant:
                offer.merchant,
              merchantDomain:
                offer.merchantDomain,
              variantLabel:
                offer.variantLabel,
              variantData:
                variantJson(
                  offer.variantData,
                ),
              image:
                offer.image,
              price: offer.price,
              shipping:
                offer.shipping,
              shippingKnown:
                Boolean(
                  offer.shippingKnown,
                ),
              totalPrice:
                offer.totalPrice,
              currency:
                offer.currency,
              sellerRating:
                offer.sellerRating,
              sellerVotes:
                offer.sellerVotes,
              deliveryMessage:
                offer.deliveryMessage,
              rawUrl: offer.url,
              dealScore:
                offer.dealScore,
              isCheapest:
                offer.isCheapest,
              isBestOverall:
                offer.isBestOverall,
            }),
          ),
        });
      }

      await prisma.priceSnapshot.create({
        data: {
          productId:
            dbProduct.id,
          price:
            product.bestPrice,
          currency:
            product.currency,
        },
      });

      const offers =
        await prisma.offer.findMany({
          where: {
            productId:
              dbProduct.id,
          },
          orderBy: [
            {
              isBestOverall:
                'desc',
            },
            {
              totalPrice:
                'asc',
            },
          ],
        });

      saved.push({
        ...product,
        id: dbProduct.id,
        storesCount: new Set(
          offers.map(
            (offer) =>
              (
                offer.merchantDomain ||
                offer.merchant
              ).toLowerCase(),
          ),
        ).size,
        offers: offers.map(
          (offer) => ({
            id: offer.id,
            merchant:
              offer.merchant,
            merchantDomain:
              offer.merchantDomain ||
              undefined,
            variantLabel:
              offer.variantLabel ||
              undefined,
            variantData:
              (offer.variantData as
                | VariantAttributes
                | null) ||
              undefined,
            image:
              offer.image ||
              undefined,
            price: offer.price,
            shipping:
              offer.shipping,
            shippingKnown:
              offer.shippingKnown,
            totalPrice:
              offer.totalPrice,
            currency:
              offer.currency,
            sellerRating:
              offer.sellerRating ||
              undefined,
            sellerVotes:
              offer.sellerVotes ||
              undefined,
            deliveryMessage:
              offer.deliveryMessage ||
              undefined,
            url:
              offer.rawUrl ||
              undefined,
            dealScore:
              offer.dealScore,
            isCheapest:
              offer.isCheapest,
            isBestOverall:
              offer.isBestOverall,
          }),
        ),
      });
    } catch (error) {
      console.error(
        'persistProducts:',
        error,
      );

      saved.push(product);
    }
  }

  return saved;
}

export async function replaceOffers(
  productId: string,
  offers: OfferView[],
) {
  if (!databaseConfigured()) return;

  const bestPrice =
    offers.length
      ? Math.min(
          ...offers.map(
            (offer) =>
              offer.totalPrice,
          ),
        )
      : undefined;

  const meaningfulScores =
    offers
      .map(
        (offer) =>
          offer.dealScore,
      )
      .filter(
        (score) => score > 0,
      );

  const productScore =
    meaningfulScores.length
      ? Math.max(
          ...meaningfulScores,
        )
      : 0;

  await prisma.$transaction([
    prisma.offer.deleteMany({
      where: { productId },
    }),
    ...(offers.length
      ? [
          prisma.offer.createMany({
            data: offers.map(
              (offer) => ({
                productId,
                merchant:
                  offer.merchant,
                merchantDomain:
                  offer.merchantDomain,
                variantLabel:
                  offer.variantLabel,
                variantData:
                  variantJson(
                    offer.variantData,
                  ),
                image:
                  offer.image,
                price:
                  offer.price,
                shipping:
                  offer.shipping,
                shippingKnown:
                  Boolean(
                    offer.shippingKnown,
                  ),
                totalPrice:
                  offer.totalPrice,
                currency:
                  offer.currency,
                sellerRating:
                  offer.sellerRating,
                sellerVotes:
                  offer.sellerVotes,
                deliveryMessage:
                  offer.deliveryMessage,
                rawUrl:
                  offer.url,
                dealScore:
                  offer.dealScore,
                isCheapest:
                  offer.isCheapest,
                isBestOverall:
                  offer.isBestOverall,
              }),
            ),
          }),
        ]
      : []),
    prisma.product.update({
      where: { id: productId },
      data: {
        currentBestPrice:
          bestPrice,
        dealScore:
          productScore,
        lastSyncedAt:
          new Date(),
        lastEnrichedAt:
          new Date(),
      },
    }),
    ...(bestPrice !== undefined
      ? [
          prisma.priceSnapshot.create({
            data: {
              productId,
              price: bestPrice,
              currency:
                offers[0]
                  ?.currency ||
                'EUR',
            },
          }),
        ]
      : []),
  ]);
}
