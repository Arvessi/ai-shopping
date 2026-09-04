import { NextResponse } from 'next/server';
import { crawlerStatus, ensureCrawlerRegistry } from '@/lib/crawler';
import { STORE_COUNT } from '@/lib/store-registry';
import { prisma } from '@/lib/db';

export async function GET() {
  await ensureCrawlerRegistry();

  const base = await crawlerStatus();

  const [sources, grouped] = await Promise.all([
    prisma.crawlSource.findMany({
      where: { active: true },
      select: {
        id: true,
        slug: true,
      },
    }),
    prisma.crawlPage.groupBy({
      by: ['sourceId', 'status'],
      _count: { _all: true },
    }),
  ]);

  const sourceIdBySlug = new Map(
    sources.map((source) => [source.slug, source.id]),
  );

  const counts = new Map<
    string,
    Record<string, number>
  >();

  for (const row of grouped) {
    const current = counts.get(row.sourceId) || {};
    current[row.status] = row._count._all;
    counts.set(row.sourceId, current);
  }

  const baseStores = base.stores as Array<{
    slug: string;
    name: string;
    origin: string;
    robotsAllowed: boolean | null;
    lastSeededAt: Date | null;
    lastRunAt: Date | null;
    lastError: string | null;
  }>;

  return NextResponse.json({
    configuredStores: STORE_COUNT,
    stores: baseStores.map((store) => {
      const sourceId = sourceIdBySlug.get(store.slug) as string | undefined;
      const storeCounts = sourceId
        ? counts.get(sourceId) || {}
        : {};

      return {
        ...store,
        pages: Object.values(storeCounts).reduce(
          (sum, value) => sum + Number(value),
          0,
        ),
        productPages: storeCounts.product || 0,
        pending: storeCounts.pending || 0,
        done: storeCounts.done || 0,
        blocked: storeCounts.blocked || 0,
        errors: storeCounts.error || 0,
      };
    }),
    totals: base.totals,
  });
}
