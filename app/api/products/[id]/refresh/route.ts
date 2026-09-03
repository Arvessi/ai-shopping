import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  createSellersTask,
  getSellersTask,
  mapFastProductSearch,
  mapSellerOffers,
  searchProductsFast,
  taskPending,
} from '@/lib/dataforseo';
import { replaceOffers } from '@/lib/products';

async function refreshViaLiveSearch(product: {
  id: string;
  title: string;
  normalizedTitle: string;
}) {
  let raw = await searchProductsFast(
    product.title,
    true,
  );
  let mapped = mapFastProductSearch(raw);

  if (!mapped.length) {
    raw = await searchProductsFast(
      product.title,
      false,
    );
    mapped = mapFastProductSearch(raw);
  }

  if (!mapped.length) {
    throw new Error(
      'Neizdevās atrast svaigus piedāvājumus šim produktam.',
    );
  }

  const candidate =
    mapped.find(
      (item) =>
        item.normalizedTitle ===
        product.normalizedTitle,
    ) || mapped[0];

  if (!candidate?.offers.length) {
    throw new Error(
      'Svaigi veikalu piedāvājumi netika atrasti.',
    );
  }

  await replaceOffers(
    product.id,
    candidate.offers,
  );

  return candidate.offers;
}

export async function POST(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  const { id } = await context.params;

  const product = await prisma.product.findUnique({
    where: { id },
  });

  if (!product) {
    return NextResponse.json(
      { error: 'Produkts nav atrasts.' },
      { status: 404 },
    );
  }

  try {
    const hasIdentity = Boolean(
      product.sourceProductId ||
        product.gid ||
        product.dataDocId,
    );

    if (!hasIdentity) {
      const offers =
        await refreshViaLiveSearch(product);

      return NextResponse.json({
        pending: false,
        mode: 'live-search',
        offers,
      });
    }

    try {
      const task = await createSellersTask({
        productId:
          product.sourceProductId ||
          undefined,
        gid: product.gid || undefined,
        dataDocId:
          product.dataDocId || undefined,
      });

      return NextResponse.json({
        pending: true,
        mode: 'merchant-sellers',
        ...task,
      });
    } catch {
      // Product IDs from SERP can occasionally stop working. Do not surface
      // that technical detail to the user; fall back to a fresh live search.
      const offers =
        await refreshViaLiveSearch(product);

      return NextResponse.json({
        pending: false,
        mode: 'live-search-fallback',
        offers,
      });
    }
  } catch (error) {
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

export async function GET(
  request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  const { id } = await context.params;
  const taskId = new URL(
    request.url,
  ).searchParams.get('taskId');

  if (!taskId) {
    return NextResponse.json(
      { error: 'Trūkst taskId.' },
      { status: 400 },
    );
  }

  try {
    const json = await getSellersTask(taskId);

    if (taskPending(json)) {
      return NextResponse.json({
        pending: true,
        taskId,
      });
    }

    const offers = mapSellerOffers(json);

    if (offers.length) {
      await replaceOffers(id, offers);
    }

    return NextResponse.json({
      pending: false,
      offers,
    });
  } catch (error) {
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
