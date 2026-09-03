import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  upsertFeedSource,
  verifyCatalogSecret,
} from '@/lib/catalog';

export async function GET(
  request: Request,
) {
  if (!verifyCatalogSecret(request)) {
    return NextResponse.json(
      { error: 'Unauthorized.' },
      { status: 401 },
    );
  }

  const sources =
    await prisma.feedSource.findMany({
      include: {
        merchant: true,
        runs: {
          orderBy: {
            startedAt: 'desc',
          },
          take: 1,
        },
      },
      orderBy: [
        {
          merchant: {
            name: 'asc',
          },
        },
        {
          name: 'asc',
        },
      ],
    });

  return NextResponse.json({
    sources,
  });
}

export async function POST(
  request: Request,
) {
  if (!verifyCatalogSecret(request)) {
    return NextResponse.json(
      { error: 'Unauthorized.' },
      { status: 401 },
    );
  }

  try {
    const body =
      await request.json();

    if (
      !body?.merchant?.name ||
      !body?.source?.url ||
      !body?.source?.format
    ) {
      return NextResponse.json(
        {
          error:
            'merchant.name, source.url and source.format are required.',
        },
        { status: 400 },
      );
    }

    const format = String(
      body.source.format,
    ).toLowerCase();

    if (
      ![
        'xml',
        'json',
        'csv',
      ].includes(format)
    ) {
      return NextResponse.json(
        {
          error:
            'source.format must be xml, json or csv.',
        },
        { status: 400 },
      );
    }

    const source =
      await upsertFeedSource({
        merchant: {
          name: String(
            body.merchant.name,
          ),
          slug:
            body.merchant.slug
              ? String(
                  body.merchant
                    .slug,
                )
              : undefined,
          domain:
            body.merchant.domain
              ? String(
                  body.merchant
                    .domain,
                )
              : undefined,
          trustScore:
            body.merchant
              .trustScore != null
              ? Number(
                  body.merchant
                    .trustScore,
                )
              : undefined,
        },
        source: {
          name:
            body.source.name
              ? String(
                  body.source.name,
                )
              : undefined,
          slug:
            body.source.slug
              ? String(
                  body.source.slug,
                )
              : undefined,
          url: String(
            body.source.url,
          ),
          format: format as
            | 'xml'
            | 'json'
            | 'csv',
          mapping:
            body.source.mapping ||
            {},
          authHeaderEnv:
            body.source
              .authHeaderEnv
              ? String(
                  body.source
                    .authHeaderEnv,
                )
              : undefined,
        },
      });

    return NextResponse.json({
      source,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Could not save feed source.',
      },
      { status: 500 },
    );
  }
}
