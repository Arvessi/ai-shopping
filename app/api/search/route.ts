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
  product_images?: string[];
  image_url?: string;
  seller?: string;
  product_id?: string;
  shopping_url?: string;
  shop_ad_aclk?: string;

  delivery_info?: {
    delivery_price?: {
      current?: number | null;
    } | null;
  };

  rating?: {
    value?: string | number;
    votes_count?: number;
    rating_max?: number;
  };
};

type Product = {
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
        location_name: 'Riga,Latvia',
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
  const taskId = task?.id;

  if (!taskId) {
    throw new Error('DataForSEO did not return a task id.');
  }

  return {
    taskId: String(taskId),
    statusCode: task?.status_code,
    statusMessage: task?.status_message,
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

  if (!response.ok) {
    throw new Error(
      json?.status_message ||
        `DataForSEO task_get failed (${response.status})`
    );
  }

  return json;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = Number(value.replace(',', '.'));

    if (Number.isFinite(normalized)) {
      return normalized;
    }
  }

  return undefined;
}

function getImage(item: DfsOffer) {
  return (
    item.product_images?.[0] ||
    item.image_url ||
    undefined
  );
}

function getMerchantUrl(item: DfsOffer) {
  /*
   * DataForSEO's current Google Shopping response marks
   * the old `url` field as deprecated. Keep it as a fallback.
   */
  if (item.url && item.url !== '#') {
    return item.url;
  }

  if (
    item.shopping_url &&
    item.shopping_url !== '#'
  ) {
    return item.shopping_url;
  }

  return '#';
}

function calculateScores(items: DfsOffer[]) {
  const validPrices = items
    .map((item) => item.price)
    .filter(
      (price): price is number =>
        typeof price === 'number' &&
        Number.isFinite(price) &&
        price > 0
    );

  if (!validPrices.length) {
    return items.map(() => 60);
  }

  const minPrice = Math.min(...validPrices);
  const maxPrice = Math.max(...validPrices);

  return items.map((item, index) => {
    const price = item.price ?? maxPrice;

    // 0-20 points for being cheap compared with the other results.
    let priceScore = 0;

    if (maxPrice > minPrice) {
      priceScore =
        ((maxPrice - price) / (maxPrice - minPrice)) * 20;
    }

    // 0-10 points for a genuine old_price discount.
    let discountScore = 0;

    if (
      typeof item.old_price === 'number' &&
      item.old_price > price
    ) {
      const discount =
        ((item.old_price - price) / item.old_price) * 100;

      discountScore = Math.min(
        10,
        Math.max(0, discount / 3)
      );
    }

    // Small quality bonus for ratings/reviews.
    let ratingScore = 0;

    const rating = toNumber(item.rating?.value);

    if (rating !== undefined) {
      const ratingMax =
        item.rating?.rating_max ?? 5;

      if (ratingMax > 0) {
        ratingScore =
          (rating / ratingMax) * 6;
      }
    }

    // Ranking bonus: higher Google Shopping positions
    // get a small relevance advantage, but not too much.
    const positionScore = Math.max(
      0,
      5 - index * 0.25
    );

    const score = Math.round(
      Math.min(
        99,
        Math.max(
          55,
          60 +
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

function mapResults(json: any): Product[] {
  const task = json?.tasks?.[0];

  if (!task) {
    throw new Error('No task returned from DataForSEO.');
  }

  if (
    task.status_code >= 40000 &&
    task.status_code !== 40601 &&
    task.status_code !== 40602
  ) {
    throw new Error(
      task.status_message ||
        'DataForSEO task failed.'
    );
  }

  const result = task.result?.[0];

  const items = (result?.items ?? []) as DfsOffer[];

  const filtered = items.filter((item) => {
    return (
      typeof item.price === 'number' &&
      item.price > 0 &&
      Boolean(item.title)
    );
  });

  const scores = calculateScores(filtered);

  return filtered.map((item, index) => {
    const title = item.title || 'Product';
    const price = item.price!;
    const currency = item.currency || 'EUR';
    const image = getImage(item);
    const url = getMerchantUrl(item);

    const merchant =
      item.seller ||
      item.domain ||
      'Merchant';

    const score = scores[index];

    const shipping =
      item.delivery_info?.delivery_price?.current;

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

          productTitle: title,

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
  const { searchParams } = new URL(request.url);

  const q = searchParams.get('q')?.trim();
  const taskId =
    searchParams.get('taskId')?.trim();

  const auth = authHeader();

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
     * EXISTING TASK
     */
    if (taskId) {
      const json = await getTask(taskId, auth);
      const task = json?.tasks?.[0];

      if (!task) {
        return NextResponse.json({
          pending: true,
          taskId,
          results: [],
          statusCode: null,
          statusMessage:
            'Task not available yet.',
        });
      }

      const statusCode =
        task.status_code ?? null;

      const statusMessage =
        task.status_message ?? null;

      /*
       * IMPORTANT:
       * 40601 and 40602 are normal waiting states,
       * NOT fatal errors.
       */
      if (
        statusCode === 40601 ||
        statusCode === 40602 ||
        statusMessage === 'Task In Queue.'
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
        Array.isArray(task.result) &&
        task.result.length > 0
      ) {
        const results = mapResults(json);

        return NextResponse.json({
          pending: false,
          taskId,
          results,
          source: 'dataforseo',
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
       * Any other non-ready state:
       * keep polling.
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
     * NEW SEARCH
     */
    if (!q) {
      return NextResponse.json(
        {
          pending: false,
          results: [],
          error: 'Missing query.',
        },
        { status: 400 }
      );
    }

    const created = await postTask(
      q,
      auth
    );

    return NextResponse.json({
      pending: true,
      taskId: created.taskId,
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
