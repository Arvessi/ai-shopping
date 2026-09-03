import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  const { id } =
    await context.params;

  try {
    const product =
      await prisma.product.findUnique({
        where: { id },
        include: {
          offers: {
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
          },
          snapshots: {
            orderBy: {
              recordedAt: 'asc',
            },
            take: 180,
          },
        },
      });

    if (!product) {
      return NextResponse.json(
        {
          error:
            'Produkts nav atrasts.',
        },
        { status: 404 },
      );
    }

    let catalogVariants:
      | Array<{
          id: string;
          variantKey: string;
          image?: string;
          attributes: Record<
            string,
            string | undefined
          >;
        }>
      | undefined;

    if (
      product.source ===
        'catalog' &&
      product.externalId.startsWith(
        'catalog:',
      )
    ) {
      const familyId =
        product.externalId.slice(
          'catalog:'.length,
        );

      const variants =
        await prisma.catalogVariant.findMany({
          where: {
            familyId,
            active: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        });

      catalogVariants =
        variants.map(
          (variant) => ({
            id: variant.id,
            variantKey:
              variant.variantKey,
            image:
              variant.image ||
              undefined,
            attributes: {
              storage:
                variant.storage ||
                undefined,
              ram:
                variant.ram ||
                undefined,
              color:
                variant.color ||
                undefined,
              connectivity:
                variant.connectivity ||
                undefined,
              size:
                variant.size ||
                undefined,
              condition:
                variant.condition ||
                undefined,
            },
          }),
        );
    }

    return NextResponse.json({
      product: {
        ...product,
        catalogVariants,
      },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          'Produkta lapai nepieciešams konfigurēts DATABASE_URL.',
      },
      { status: 500 },
    );
  }
}
