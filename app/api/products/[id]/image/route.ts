import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const maxDuration = 15;

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function safePublicUrl(value: string) {
  try {
    const url = new URL(value);

    if (
      url.protocol !== 'http:' &&
      url.protocol !== 'https:'
    ) {
      return null;
    }

    const host =
      url.hostname.toLowerCase();

    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local')
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function resolveImage(
  raw: string,
  pageUrl: URL,
) {
  try {
    const url = new URL(
      decodeHtml(raw.trim()),
      pageUrl,
    );

    return /^https?:$/i.test(
      url.protocol,
    )
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function imageFromHtml(
  html: string,
  pageUrl: URL,
) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match =
      html.match(pattern);

    if (match?.[1]) {
      const image =
        resolveImage(
          match[1],
          pageUrl,
        );

      if (image) return image;
    }
  }

  const jsonImage =
    html.match(
      /"image"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i,
    ) ||
    html.match(
      /"image"\s*:\s*\[\s*"([^"]+)"/i,
    );

  return jsonImage?.[1]
    ? resolveImage(
        jsonImage[1].replace(
          /\\\//g,
          '/',
        ),
        pageUrl,
      )
    : null;
}

async function fetchMerchantImage(
  rawUrl: string,
) {
  const pageUrl =
    safePublicUrl(rawUrl);

  if (!pageUrl) return null;

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    3500,
  );

  try {
    const response = await fetch(
      pageUrl.toString(),
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; CENIQ/1.0; product-image-preview)',
          Accept:
            'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
        signal:
          controller.signal,
        cache: 'no-store',
      },
    );

    if (!response.ok) {
      return null;
    }

    const contentType =
      response.headers.get(
        'content-type',
      ) || '';

    if (
      !contentType.includes(
        'text/html',
      )
    ) {
      return null;
    }

    const html = (
      await response.text()
    ).slice(
      0,
      750_000,
    );

    return imageFromHtml(
      html,
      new URL(
        response.url ||
          pageUrl,
      ),
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  const { id } =
    await context.params;

  const product =
    await prisma.product.findUnique({
      where: { id },
      include: {
        offers: {
          orderBy: {
            totalPrice: 'asc',
          },
          take: 4,
        },
      },
    });

  if (!product) {
    return NextResponse.json(
      { image: null },
      { status: 404 },
    );
  }

  if (product.image) {
    return NextResponse.json({
      image: product.image,
      cached: true,
    });
  }

  for (const offer of product.offers) {
    if (!offer.rawUrl) {
      continue;
    }

    const image =
      await fetchMerchantImage(
        offer.rawUrl,
      );

    if (!image) continue;

    await prisma.product.update({
      where: { id },
      data: { image },
    });

    return NextResponse.json({
      image,
      cached: false,
    });
  }

  return NextResponse.json({
    image: null,
    cached: false,
  });
}
