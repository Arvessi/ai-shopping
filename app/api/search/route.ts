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
  currency?: string;
  image_url?: string;
  seller?: string;
  source?: string;
  product_id?: string;
  rank_group?: number;
  rating?: { value?: number; votes_count?: number };
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
    throw new Error(json?.status_message || `DataForSEO task_post failed (${response.status})`);
  }

  const taskId = json?.tasks?.[0]?.id;
  if (!taskId) throw new Error('DataForSEO did not return a task id.');
  return taskId as string;
}

async function getTask(taskId: string, auth: string) {
  const response = await fetch(`${API_URL}/task_get/advanced/${taskId}`, {
    headers: { Authorization: auth },
    cache: 'no-store',
  });
  const json = await response.json();
  if (!response.ok || json?.status_code !== 20000) {
    throw new Error(json?.status_message || `DataForSEO task_get failed (${response.status})`);
  }
  return json;
}

function mapResults(json: any) {
  const task = json?.tasks?.[0];
  if (!task) throw new Error('No task returned from DataForSEO.');
  if (task.status_code >= 40000) throw new Error(task.status_message || 'DataForSEO task failed.');

  const result = task.result?.[0];
  const items = (result?.items ?? []) as DfsOffer[];

  const normalized = items
    .filter((item) => typeof item.price === 'number' && item.price > 0 && item.title)
    .map((item, index) => ({
      id: item.product_id || `${index}-${item.title}`,
      title: item.title || 'Product',
      brand: item.title?.split(' ')[0] || '',
      category: 'Shopping',
      bestPrice: item.price!,
      currency: item.currency || 'EUR',
      dealScore: Math.max(50, 96 - index * 2),
      image: item.image_url,
      offers: [
        {
          merchant: item.domain || item.seller || 'Merchant',
          price: item.price!,
          shipping: 0,
          currency: item.currency || 'EUR',
          dealScore: Math.max(50, 96 - index * 2),
          productTitle: item.title || 'Product',
          image: item.image_url,
          url: item.url || '#',
          affiliate: false,
          updatedAt: new Date().toISOString(),
        },
      ],
    }));

  return normalized;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim();

  if (!q) {
    return NextResponse.json({ results: [], error: 'Missing query.' }, { status: 400 });
  }

  const auth = authHeader();
  if (!auth) {
    return NextResponse.json(
      { results: [], error: 'DataForSEO credentials are not configured in Vercel.' },
      { status: 500 },
    );
  }

  try {
    const taskId = await postTask(q, auth);

    // DataForSEO uses separate POST/GET retrieval. Poll briefly so the MVP can return
    // in one browser request without a second frontend workflow.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const json = await getTask(taskId, auth);
      const task = json?.tasks?.[0];
      if (task?.status_code >= 40000) {
        throw new Error(task.status_message || 'DataForSEO task failed.');
      }
      if (Array.isArray(task?.result) && task.result.length > 0) {
        return NextResponse.json({ results: mapResults(json), source: 'dataforseo' });
      }
    }

    return NextResponse.json(
      { results: [], error: 'The search is still processing. Please try again in a few seconds.' },
      { status: 202 },
    );
  } catch (error) {
    console.error('DataForSEO search error:', error);
    return NextResponse.json(
      { results: [], error: error instanceof Error ? error.message : 'Search failed.' },
      { status: 502 },
    );
  }
}
