import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  createProductsTask,
  createSellersTask,
  getProductsTask,
  getSellersTask,
  mapFastProductSearch,
  mapSellerOffers,
  searchProductsFast,
  selectMerchantProductCandidate,
  taskPending,
} from '@/lib/dataforseo';
import { replaceOffers } from '@/lib/products';

const ENRICH_TTL_MS =
  12 * 60 * 60 * 1000;

async function liveFallback(product: {
  id: string;
  title: string;
  normalizedTitle: string;
}) {
  let raw = await searchProductsFast(
    product.title,
    true,
  );

  let mapped =
    mapFastProductSearch(raw);

  if (!mapped.length) {
    raw = await searchProductsFast(
      product.title,
      false,
    );

    mapped =
      mapFastProductSearch(raw);
  }

  const candidate =
    mapped.find(
      (item) =>
        item.normalizedTitle ===
        product.normalizedTitle,
    ) || mapped[0];

  if (!candidate?.offers.length) {
    await prisma.product.update({
      where: { id: product.id },
      data: {
        lastEnrichedAt: new Date(),
      },
    });

    return [];
  }

  await replaceOffers(
    product.id,
    candidate.offers,
  );

  if (candidate.image) {
    await prisma.product.update({
      where: { id: product.id },
      data: { image: candidate.image },
    });
  }

  return candidate.offers;
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  const { id } =
    await context.params;

  const force =
    new URL(
      request.url,
    ).searchParams.get(
      'force',
    ) === '1';

  const product =
    await prisma.product.findUnique({
      where: { id },
    });

  if (!product) {
    return NextResponse.json(
      { error: 'Produkts nav atrasts.' },
      { status: 404 },
    );
  }

  if (
    !force &&
    product.lastEnrichedAt &&
    Date.now() -
      product.lastEnrichedAt.getTime() <
      ENRICH_TTL_MS
  ) {
    return NextResponse.json({
      pending: false,
      cached: true,
    });
  }

  try {
    const hasIdentity = Boolean(
      product.sourceProductId ||
        product.gid ||
        product.dataDocId,
    );

    if (hasIdentity) {
      try {
        const task =
          await createSellersTask({
            productId:
              product.sourceProductId ||
              undefined,
            gid:
              product.gid ||
              undefined,
            dataDocId:
              product.dataDocId ||
              undefined,
          });

        return NextResponse.json({
          pending: true,
          stage: 'sellers',
          ...task,
        });
      } catch {
        // stale identity -> product lookup
      }
    }

    const task =
      await createProductsTask(
        product.title,
      );

    return NextResponse.json({
      pending: true,
      stage: 'products',
      ...task,
    });
  } catch (error) {
    try {
      const offers =
        await liveFallback(product);

      return NextResponse.json({
        pending: false,
        stage: 'live-fallback',
        offers,
      });
    } catch {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Neizdevās atjaunot piedāvājumus.',
        },
        { status: 502 },
      );
    }
  }
}

export async function GET(
  request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  const { id } =
    await context.params;

  const url =
    new URL(request.url);

  const taskId =
    url.searchParams.get(
      'taskId',
    );

  const stage =
    url.searchParams.get(
      'stage',
    ) || 'sellers';

  if (!taskId) {
    return NextResponse.json(
      { error: 'Trūkst taskId.' },
      { status: 400 },
    );
  }

  const product =
    await prisma.product.findUnique({
      where: { id },
    });

  if (!product) {
    return NextResponse.json(
      { error: 'Produkts nav atrasts.' },
      { status: 404 },
    );
  }

  try {
    if (stage === 'products') {
      const json =
        await getProductsTask(
          taskId,
        );

      if (taskPending(json)) {
        return NextResponse.json({
          pending: true,
          stage: 'products',
          taskId,
        });
      }

      const candidate =
        selectMerchantProductCandidate(
          json,
          product.title,
        );

      if (!candidate) {
        const offers =
          await liveFallback(product);

        return NextResponse.json({
          pending: false,
          stage: 'live-fallback',
          offers,
        });
      }

      await prisma.product.update({
        where: { id },
        data: {
          sourceProductId:
            candidate.productId,
          gid: candidate.gid,
          dataDocId:
            candidate.dataDocId,
          image:
            candidate.image ||
            product.image ||
            undefined,
        },
      });

      const sellers =
        await createSellersTask({
          productId:
            candidate.productId,
          gid: candidate.gid,
          dataDocId:
            candidate.dataDocId,
        });

      return NextResponse.json({
        pending: true,
        stage: 'sellers',
        ...sellers,
      });
    }

    const json =
      await getSellersTask(
        taskId,
      );

    if (taskPending(json)) {
      return NextResponse.json({
        pending: true,
        stage: 'sellers',
        taskId,
      });
    }

    const offers =
      mapSellerOffers(json);

    if (offers.length) {
      await replaceOffers(
        id,
        offers,
      );
    } else {
      await prisma.product.update({
        where: { id },
        data: {
          lastEnrichedAt:
            new Date(),
        },
      });
    }

    return NextResponse.json({
      pending: false,
      stage: 'done',
      offers,
    });
  } catch (error) {
    try {
      const offers =
        await liveFallback(product);

      return NextResponse.json({
        pending: false,
        stage: 'live-fallback',
        offers,
      });
    } catch {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Piedāvājumu atjaunošana neizdevās.',
        },
        { status: 502 },
      );
    }
  }
}
