import { NextResponse } from 'next/server';

const API_URL =
  'https://api.dataforseo.com/v3/merchant/google/products';

function authHeader() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) return null;

  return `Basic ${Buffer.from(
    `${login}:${password}`
  ).toString('base64')}`;
}

type DfsOffer = {
  title?: string;
  domain?: string;
  url?: string | null;
  price?: number;
  old_price?: number;
  currency?: string;

  image_url?: string;
  product_images?: string[];

  seller?: string;
  product_id?: string;

  shopping_url?: string;
  shop_ad_aclk?: string;

  rating?: {
    value?: number | string;
    votes_count?: number;
    rating_max?: number;
  };

  delivery_info?: {
    delivery_price?: {
      current?: number | null;
    } | null;
  };
};

type ProductResult = {
  id: string;
  title: string;
  brand: string;
  category: string;
  bestPrice: number;
  currency: string;
  dealScore: number;
  image?: string;
  offers: {
    merchant: string;
    price: number;
    shipping: number;
    currency: string;
    dealScore: number;
    productTitle: string;
    image?: string;
    url: string;
    affiliate: boolean;
    updatedAt: string;
  }[];
};

function getImage(item: DfsOffer) {
  return (
    item.product_images?.[0] ||
    item.image_url ||
    undefined
  );
}

function getUrl(item: DfsOffer) {
  if (item.url && item.url !== '#') {
    return item.url;
  }

  if (item.shop_ad_aclk && item.shop_ad_aclk !== '#') {
    return item.shop_ad_aclk;
  }

  if (item.shopping_url && item.shopping_url !== '#') {
    return item.shopping_url;
  }

  return '#';
}

async function postTask(keyword: string, auth: string) {
  const response = await fetch(`${API_URL}/task_post`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      {
        language_code: 'lv',

        // Riga coordinates.
        // DataForSEO requires a radius >= 199.9 km.
        location_coordinate: '56.9496,24.1052,200',

        keyword,

        depth: 20,

        priority: 1,
      },
    ]),
    cache: 'no-store',
  });

  const json = await response.json();

  if (!response.ok || json?.status_code !== 20000) {
    throw new Error(
      json?.status_message ||
        `DataForSEO task_post failed (${response.status})`
    );
  }

  const task = json?.tasks?.[0];

  if (!task?.id) {
    throw new Error(
      'DataForSEO did not return a task id.'
    );
  }

  return {
    taskId: String(task.id),
    statusCode: task.status_code,
    statusMessage: task.status_message,
  };
}

async function getTask(taskId: string, auth: string) {
  const response = await fetch(
    `${API_URL}/task_get/advanced/${encodeURIComponent(taskId)}`,
    {
      headers: {
        Authorization: auth,
      },
      cache: 'no-store',
    }
  );

  const json = await response.json();

  /*
   * DataForSEO can return task status in the JSON body even
   * when the HTTP response itself is successful.
   */
  if (!response.ok) {
    throw new Error(
      json?.status_message ||
        `DataForSEO task_get failed (${response.status})`
    );
  }

  return json;
}

function calculateScores(items: DfsOffer[]) {
  const prices = items
    .map((item) => item.price)
    .filter(
      (price): price is number =>
        typeof price === 'number' &&
        Number.isFinite(price) &&
        price > 0
    );

  if (!prices.length) {
    return items.map(() => 60);
  }

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  return items.map((item, index) => {
    const price = item.price ?? maxPrice;

    /*
     * Price competitiveness: up to 25 points.
     */
    let priceScore = 0;

    if (maxPrice > minPrice) {
      priceScore =
        ((maxPrice - price) /
          (maxPrice - minPrice)) *
        25;
    } else {
      priceScore = 25;
    }

    /*
     * Discount: up to 10 points.
     */
    let discountScore = 0;

    if (
      typeof item.old_price === 'number' &&
      item.old_price > price
    ) {
      const discount =
        ((item.old_price - price) /
          item.old_price) *
        100;

      discountScore = Math.min(
        10,
        Math.max(0, discount / 3)
      );
    }

    /*
     * Rating: up to 8 points.
     */
    let ratingScore = 0;

    if (
      item.rating &&
      item.rating.value !== undefined
    ) {
      const rating = Number(
        item.rating.value
      );

      const maxRating =
        item.rating.rating_max || 5;

      if (
        Number.isFinite(rating) &&
        maxRating > 0
      ) {
        ratingScore =
          (rating / maxRating) * 8;
      }
    }

    /*
     * Search relevance/position:
     * up to 7 points.
     */
    const positionScore = Math.max(
      0,
      7 - index * 0.35
    );

    const score = Math.round(
      Math.min(
        99,
        Math.max(
          50,
          50 +
            priceScore +
            discountScore +
            ratingScore +
            positionScore
        )
      )
    );

    return score;
  });
}

function mapResults(json: any): ProductResult[] {
  const task = json?.tasks?.[0];

  if (!task) {
    throw new Error(
      'No task returned from DataForSEO.'
    );
  }

  const result = task.result?.[0];

  if (!result) {
    return [];
  }

  const items = (
    result.items ?? []
  ) as DfsOffer[];

  const filtered = items.filter(
    (item) =>
      typeof item.price === 'number' &&
      item.price > 0 &&
      Boolean(item.title)
  );

  const scores =
    calculateScores(filtered);

  return filtered.map((item, index) => {
    const title =
      item.title || 'Product';

    const price =
      item.price ?? 0;

    const currency =
      item.currency || 'EUR';

    const image =
      getImage(item);

    const url =
      getUrl(item);

    const merchant =
      item.seller ||
      item.domain ||
      'Merchant';

    const score =
      scores[index];

    const shipping =
      item.delivery_info
        ?.delivery_price
        ?.current;

    return {
      id:
        item.product_id ||
        `${index}-${title}`,

      title,

      brand:
        title.split(' ')[0] || '',

      category: 'Shopping',

      bestPrice: price,

      currency,

      dealScore: score,

      image,

      offers: [
        {
          merchant,

          price,

          shipping:
            typeof shipping === 'number'
              ? shipping
              : 0,

          currency,

          dealScore: score,

          productTitle:
            title,

          image,

          url,

          affiliate: false,

          updatedAt:
            new Date().toISOString(),
        },
      ],
    };
  });
}

export async function GET(request: Request) {
  const { searchParams } =
    new URL(request.url);

  const q =
    searchParams.get('q')?.trim();

  const taskId =
    searchParams
      .get('taskId')
      ?.trim();

  const auth =
    authHeader();

  if (!auth) {
    return NextResponse.json(
      {
        pending: false,
        results: [],
        error:
          'DataForSEO credentials are not configured in Vercel.',
      },
      { status: 500 }
    );
  }

  try {
    /*
     * =====================================================
     * EXISTING TASK
     * =====================================================
     */
    if (taskId) {
      const json =
        await getTask(
          taskId,
          auth
        );

      const task =
        json?.tasks?.[0];

      /*
       * 40401 can happen while the task is
       * not yet available to task_get.
       * Do not kill the frontend immediately.
       */
      if (!task) {
        return NextResponse.json({
          pending: true,
          taskId,
          results: [],
          statusCode: 40602,
          statusMessage:
            'Task In Queue.',
        });
      }

      const statusCode =
        task.status_code ?? 0;

      const statusMessage =
        task.status_message ?? '';

      /*
       * IMPORTANT:
       *
       * 40601 = Task Handed
       * 40602 = Task In Queue
       *
       * Both mean KEEP POLLING.
       */
      if (
        statusCode === 40601 ||
        statusCode === 40602 ||
        statusMessage ===
          'Task In Queue.'
      ) {
        return NextResponse.json({
          pending: true,
          taskId,
          results: [],
          statusCode,
          statusMessage,
        });
      }

      /*
       * READY
       */
      if (
        statusCode === 20000 &&
        Array.isArray(task.result)
      ) {
        const results =
          mapResults(json);

        return NextResponse.json({
          pending: false,
          taskId,
          results,
          source:
            'dataforseo',
          statusCode,
          statusMessage,
        });
      }

      /*
       * REAL ERROR
       */
      if (statusCode >= 40000) {
        return NextResponse.json({
          pending: false,
          taskId,
          results: [],
          statusCode,
          statusMessage,
          error:
            statusMessage ||
            'DataForSEO task failed.',
        });
      }

      /*
       * Unknown/in-progress status.
       */
      return NextResponse.json({
        pending: true,
        taskId,
        results: [],
        statusCode,
        statusMessage,
      });
    }

    /*
     * =====================================================
     * NEW SEARCH
     * =====================================================
     */
    if (!q) {
      return NextResponse.json(
        {
          pending: false,
          results: [],
          error:
            'Missing query.',
        },
        { status: 400 }
      );
    }

    const created =
      await postTask(
        q,
        auth
      );

    return NextResponse.json({
      pending: true,
      taskId:
        created.taskId,
      results: [],
      statusCode:
        created.statusCode,
      statusMessage:
        created.statusMessage,
    });
  } catch (error) {
    console.error(
      'DataForSEO search error:',
      error
    );

    return NextResponse.json(
      {
        pending: false,
        results: [],
        error:
          error instanceof Error
            ? error.message
            : 'Search failed.',
      },
      { status: 502 }
    );
  }
}
