import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  crawlSourceBatch,
  ensureCrawlerRegistry,
  runCrawlerCycle,
} from '@/lib/crawler';
import { verifyCatalogSecret } from '@/lib/catalog';

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!verifyCatalogSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    await ensureCrawlerRegistry();
    const body = await request.json().catch(() => ({}));
    const store = body?.store ? String(body.store) : '';
    const limit = Math.min(20, Math.max(1, Number(body?.limit || 8)));

    if (!store) {
      return NextResponse.json({ result: await runCrawlerCycle(limit) });
    }

    const source = await prisma.crawlSource.findUnique({
      where: { slug: store },
    });

    if (!source) {
      return NextResponse.json({ error: 'Crawler store not found.' }, { status: 404 });
    }

    return NextResponse.json({
      result: await crawlSourceBatch(source.id, limit),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Crawler run failed.' },
      { status: 500 },
    );
  }
}
