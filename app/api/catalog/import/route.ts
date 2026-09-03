import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  importFeedSource,
  verifyCatalogSecret,
} from '@/lib/catalog';

export const maxDuration = 60;

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
      await request.json().catch(
        () => ({}),
      );

    if (body?.all === true) {
      const sources =
        await prisma.feedSource.findMany({
          where: {
            active: true,
            merchant: {
              active: true,
            },
          },
          select: {
            id: true,
            slug: true,
          },
          orderBy: {
            lastImportedAt: 'asc',
          },
        });

      const results = [];

      for (const source of sources) {
        try {
          results.push({
            ok: true,
            ...(await importFeedSource(
              source.id,
            )),
          });
        } catch (error) {
          results.push({
            ok: false,
            source: source.slug,
            error:
              error instanceof Error
                ? error.message
                : 'Import failed.',
          });
        }
      }

      return NextResponse.json({
        results,
      });
    }

    const sourceSlug =
      body?.sourceSlug
        ? String(
            body.sourceSlug,
          )
        : '';

    const sourceId =
      body?.sourceId
        ? String(
            body.sourceId,
          )
        : '';

    if (!sourceSlug && !sourceId) {
      return NextResponse.json(
        {
          error:
            'Provide sourceSlug/sourceId or {"all":true}.',
        },
        { status: 400 },
      );
    }

    const source =
      sourceId
        ? await prisma.feedSource.findUnique({
            where: {
              id: sourceId,
            },
          })
        : await prisma.feedSource.findUnique({
            where: {
              slug: sourceSlug,
            },
          });

    if (!source) {
      return NextResponse.json(
        {
          error:
            'Feed source not found.',
        },
        { status: 404 },
      );
    }

    const result =
      await importFeedSource(
        source.id,
      );

    return NextResponse.json({
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Catalog import failed.',
      },
      { status: 500 },
    );
  }
}
