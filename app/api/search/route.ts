import { NextResponse } from 'next/server';

const API_URL = 'https://api.dataforseo.com/v3/merchant/google/products';

function authHeader() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) return null;

  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;
}

type DfsOffer = {
  title?: string;
  domain?: string;
  url?: string;
  price?: number;
  old_price?: number;
  currency?: string;
  image_url?: string;
  seller?: string;
  product_id?: string;
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
        language_code: 'en',
        location_code: 2203,
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

function mapResults(json: any) {
  const task = json?.tasks?.[0];

  if (!task) {
    throw new Error('No task returned from DataForSEO.');
  }

  if (task.status_code >= 40000) {
    throw new Error(
      task.status_message || 'DataForSEO task failed.'
    );
  }

  const result = task.result?.[0];
  const items = (result?.items ?? []) as DfsOffer[];

  return items
    .filter(
      (item) =>
        typeof item.price === 'number' &&
        item.price > 0 &&
        item.title
    )
    .map((item, index) => {
      const currentPrice = item.price!;

      const oldPrice =
        typeof item.old_price === 'number' &&
        item.old_price > currentPrice
          ? item.old_price
          : undefined;

      const discount = oldPrice
        ? Math.round((1 - currentPrice / oldPrice) * 100)
        : 0;

      const score = Math.min(
        99,
        Math.max(55, 70 + Math.min(discount, 20) - index)
      );

      const title = item.title || 'Product';

      return {
        id: item.product_id || `${index}-${title}`,
        title,
        brand: title.split(' ')[0] || '',
        category: 'Shopping',
        bestPrice: currentPrice,
        currency: item.currency || 'EUR',
        dealScore: score,
        image: item.image_url,
        offers: [
          {
            merchant:
              item.domain ||
              item.seller ||
              'Merchant',
            price: currentPrice,
            shipping: 0,
            currency: item.currency || 'EUR',
            dealScore: score,
            productTitle: title,
            image: item.image_url,
            url: item.url || '#',
            affiliate: false,
            updatedAt: new Date().toISOString(),
          },
        ],
      };
    });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const q = searchParams.get('q')?.trim();
  const taskId = searchParams.get('taskId')?.trim();

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
    // 1. Existing task -> check status
    if (taskId) {
      const json = await getTask(taskId, auth);
      const task = json?.tasks?.[0];

      if (!task) {
        return NextResponse.json({
          pending: true,
          taskId,
          results: [],
          statusCode: null,
          statusMessage: 'Task not found yet.',
        });
      }

      const statusCode = task.status_code ?? null;
      const statusMessage = task.status_message ?? null;

      // DataForSEO error
      if (statusCode >= 40000) {
        return NextResponse.json({
          pending: false,
          taskId,
          results: [],
          statusCode,
          statusMessage,
          error: statusMessage || 'DataForSEO task failed.',
        });
      }

      // Results ready
      if (Array.isArray(task.result) && task.result.length > 0) {
        return NextResponse.json({
          pending: false,
          taskId,
          results: mapResults(json),
          source: 'dataforseo',
          statusCode,
          statusMessage,
        });
      }

      // Still processing
      return NextResponse.json({
        pending: true,
        taskId,
        results: [],
        statusCode,
        statusMessage,
      });
    }

    // 2. New search
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

    const created = await postTask(q, auth);

    return NextResponse.json({
      pending: true,
      taskId: created.taskId,
      results: [],
      statusCode: created.statusCode,
      statusMessage: created.statusMessage,
    });
  } catch (error) {
    console.error('DataForSEO search error:', error);

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
