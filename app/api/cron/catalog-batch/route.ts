import { NextResponse } from 'next/server';
import { createDefaultCollectorHandlers } from '@/collector/default-handlers';
import { persistCollectedOffers } from '@/collector/canonical-bridge';
import { syncCollectorStore } from '@/collector/orchestrator';
import { collectorStores } from '@/collector/store-registry';

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  const isLocalDev = process.env.NODE_ENV !== 'production';
  if (!isLocalDev && (!secret || auth !== `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const requested = (url.searchParams.get('stores') || 'euronics,m79,bite,lmt,tele2,rd')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const uniqueSlugs = [...new Set(requested)].slice(0, 6);

  const requestedLimit = Number(url.searchParams.get('limit') || 40);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 40, 1), 100);
  const rawCursor = url.searchParams.get('cursor');
  const requestedCursor = rawCursor == null ? Number.NaN : Number(rawCursor);
  const cursor = Number.isFinite(requestedCursor) && requestedCursor >= 0
    ? Math.floor(requestedCursor)
    : Math.floor(Date.now() / 86_400_000);

  const stores = uniqueSlugs
    .map((slug) => collectorStores.find((store) => store.slug === slug))
    .filter((store): store is NonNullable<typeof store> => Boolean(store));

  const unknownStores = uniqueSlugs.filter((slug) => !stores.some((store) => store.slug === slug));
  if (!stores.length) {
    return NextResponse.json({ error: 'No valid collector stores selected', unknownStores }, { status: 400 });
  }

  const handlers = createDefaultCollectorHandlers({
    maxSitemaps: 12,
    maxProductPages: limit,
    pageDelayMs: 250,
    sampleOffset: cursor,
    priorityQueries: ['Samsung Galaxy S25', 'iPhone 16', 'Sony WH-1000XM5', 'Lenovo Legion 5', 'LG OLED C4', 'Canon EOS R50', 'Epson EcoTank L3250'],
  });

  const startedAt = Date.now();
  const results = [];
  let totalCollected = 0;
  let totalAccepted = 0;
  let totalRejected = 0;
  let urlsDiscovered = 0;
  let productPagesExamined = 0;
  const rejectionReasons: Record<string, number> = {};

  for (const store of stores) {
    const storeStartedAt = Date.now();
    const sync = await syncCollectorStore(store, handlers);
    const persistence = await persistCollectedOffers(sync.offers);
    totalCollected += sync.offers.length;
    totalAccepted += persistence.accepted;
    totalRejected += persistence.rejected;
    for (const attempt of sync.attempts) {
      urlsDiscovered += attempt.discovered || 0;
      productPagesExamined += attempt.examined || 0;
      for (const [reason, count] of Object.entries(attempt.rejectionReasons || {})) rejectionReasons[reason] = (rejectionReasons[reason] || 0) + count;
    }
    for (const [reason, count] of Object.entries(persistence.rejectionReasons)) rejectionReasons[reason] = (rejectionReasons[reason] || 0) + count;

    results.push({
      store: { slug: store.slug, name: store.name },
      selectedSource: sync.selectedSource || null,
      offersCollected: sync.offers.length,
      persisted: {
        examined: persistence.examined,
        accepted: persistence.accepted,
        rejected: persistence.rejected,
      },
      attempts: sync.attempts,
      durationMs: Date.now() - storeStartedAt,
    });
  }

  return NextResponse.json({
    ok: true,
    storesRequested: uniqueSlugs,
    unknownStores,
    summary: {
      storesRun: stores.length,
      storesWithOffers: results.filter((result) => result.offersCollected > 0).length,
      totalCollected,
      totalAccepted,
      totalRejected,
      urlsDiscovered,
      productPagesExamined,
      productsParsed: totalCollected,
      distinctMerchants: new Set(results.filter((result) => result.persisted.accepted > 0).map((result) => result.store.slug)).size,
      rejectionReasons,
    },
    results,
    durationMs: Date.now() - startedAt,
    tavilyCalls: 0,
    cursor,
    note: isLocalDev
      ? 'Local batch sync: auth bypassed only outside production; Tavily is disabled.'
      : 'Production batch sync: CRON_SECRET required; Tavily is disabled.',
  });
}
