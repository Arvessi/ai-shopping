import { NextResponse } from 'next/server';

const API_URL =
  'https://api.dataforseo.com/v3/merchant/google/products/live/advanced';

function getAuthHeader() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    return null;
  }

  return `Basic ${Buffer.from(
    `${login}:${password}`
  ).toString('base64')}`;
}

type DfsItem = {
  product_id?: string;
  title?: string;
  seller?: string;
  domain?: string;
  url?: string;
  shopping_url?: string;
  shop_ad_aclk?: string;

  price?: number;
  old_price?: number;
  currency?: string;

  image_url?: string;
  product_images?: string[];

  rating?: {
    value?: number;
    votes_count?: number;
    rating_max?: number;
  };

  delivery_price?: number;
};

function getImage(item: DfsItem): string | undefined {
  return (
    item.product_images?.[0] ||
    item.image_url ||
    undefined
  );
}

function getProductUrl(item: DfsItem): string {
  return (
    item.url ||
    item.shopping_url ||
    item.shop_ad_aclk ||
    '#'
  );
}

function calculateDealScores(items: DfsItem[]) {
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

  const cheapest = Math.min(...prices);
  const expensive = Math.max(...prices);

  return items.map((item, index) => {
    const price = item.price ?? expensive;

    // Price score: 0-35
    let priceScore = 0;

    if (expensive > cheapest) {
      priceScore =
        ((expensive - price) /
          (expensive - cheapest)) *
        35;
    } else {
      priceScore = 35;
    }

    // Discount score: 0-15
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
        15,
        discount * 0.5
      );
    }

    // Rating score: 0-10
    let ratingScore = 0;

    if (
      typeof item.rating?.value === 'number'
    ) {
      const maxRating =
        item.rating.rating_max || 5;

      ratingScore =
        (item.rating.value / maxRating) * 10;
    }

    // Search position/relevance: 0-10
    const relevanceScore = Math.max(
      0,
      10 - index * 0.5
    );

    return Math.round(
      Math.min(
        99,
        Math.max(
          50,
          50 +
            priceScore +
            discountScore +
            ratingScore +
            relevanceScore
        )
      )
    );
  });
}

function mapResults(json: any) {
  const task = json?.tasks?.[0];

  if (!task) {
    throw new Error(
      'DataForSEO returned no task.'
    );
  }

  if (task.status_code >= 40000) {
    throw new Error(
      task.status_message ||
        'DataForSEO search failed.'
    );
  }

  const result = task.result?.[0];

  if (!result) {
    return [];
  }

  const items = (
    result.items ?? []
  ) as DfsItem[];

  const validItems = items.filter(
    (item) =>
      typeof item.price === 'number' &&
      item.price > 0 &&
      Boolean(item.title)
  );

  const scores =
    calculateDealScores(validItems);

  return validItems.map((item, index) => {
    const title =
      item.title || 'Product';

    const price =
      item.price || 0;

    const currency =
      item.currency || 'EUR';

    const image =
      getImage(item);

    const url =
      getProductUrl(item);

    const merchant =
      item.seller ||
      item.domain ||
      'Merchant';

    const score =
      scores[index];

    return {
      id:
        item.product_id ||
        `${index}-${title}`,

      title,

      brand:
        title.split(' ')[0] || '',

      category:
        'Shopping',

      bestPrice:
        price,

      currency,

      dealScore:
        score,

      image,

      offers: [
        {
          merchant,

          price,

          shipping:
            typeof item.delivery_price === 'number'
              ? item.delivery_price
              : 0,

          currency,

          dealScore:
            score,

          productTitle:
            title,

          image,

          url,

          affiliate:
            false,

          updatedAt:
            new Date().toISOString(),
        },
      ],
    };
  });
}

export async function GET(
  request: Request
) {
  const { searchParams } =
    new URL(request.url);

  const q =
    searchParams.get('q')?.trim();

  if (!q) {
    return NextResponse.json(
      {
        results: [],
        error: 'Missing query.',
      },
      { status: 400 }
    );
  }

  const auth =
    getAuthHeader();

  if (!auth) {
    return NextResponse.json(
      {
        results: [],
        error:
          'DataForSEO credentials are not configured in Vercel.',
      },
      { status: 500 }
    );
  }

  try {
    const response =
      await fetch(API_URL, {
        method: 'POST',

        headers: {
          Authorization: auth,
          'Content-Type':
            'application/json',
        },

        body: JSON.stringify([
          {
            keyword: q,

            language_code:
              'lv',

            location_coordinate:
              '56.9496,24.1052,200',

            depth: 40,

            device:
              'desktop',

            os:
              'windows',
          },
        ]),

        cache: 'no-store',
      });

    const json =
      await response.json();

    if (!response.ok) {
      throw new Error(
        json?.status_message ||
          `DataForSEO request failed (${response.status})`
      );
    }

    if (
      json?.status_code !==
      20000
    ) {
      throw new Error(
        json?.status_message ||
          'DataForSEO request failed.'
      );
    }

    const results =
      mapResults(json);

    return NextResponse.json({
      pending: false,

      results,

      source:
        'dataforseo-live',

      count:
        results.length,
    });
  } catch (error) {
    console.error(
      'DataForSEO live search error:',
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
