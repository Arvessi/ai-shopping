import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  ensureCrawlerRegistry,
  seedCrawlerSource,
} from '@/lib/crawler';
import { verifyCatalogSecret } from '@/lib/catalog';
import { STORE_COUNT } from '@/lib/store-registry';

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!verifyCatalogSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    await ensureCrawlerRegistry();
    const body = await request.json().catch(() => ({}));
    const store = body?.store ? String(body.store) : '';
    const count = Math.min(3, Math.max(1, Number(body?.count || 1)));

    const sources = store
      ? await prisma.crawlSource.findMany({
          where: { slug: store, active: true },
          take: 1,
        })
      : await prisma.crawlSource.findMany({
          where: { active: true },
          orderBy: [
            { lastSeededAt: 'asc' },
            { priority: 'desc' },
          ],
          take: count,
        });

    if (!sources.length) {
      return NextResponse.json({ error: 'Crawler store not found.' }, { status: 404 });
    }

    const results = [];

    for (const source of sources) {
      try {
        results.push(await seedCrawlerSource(source.id));
      } catch (error) {
        results.push({
          source: source.slug,
          error: error instanceof Error ? error.message : 'Seed failed.',
        });
      }
    }

    return NextResponse.json({
      registeredStores: STORE_COUNT,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Crawler bootstrap failed.' },
      { status: 500 },
    );
  }
}
