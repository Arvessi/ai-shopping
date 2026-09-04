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
  const requested = (url.searchParams.get('stores') || 'bite,euronics,m79,lmt')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const uniqueSlugs = [...new Set(requested)].slice(0, 6);

  const requestedLimit = Number(url.searchParams.get('limit') || 12);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 12, 1), 20);

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
  });

  const startedAt = Date.now();
  const results = [];
  let totalCollected = 0;
  let totalAccepted = 0;
  let totalRejected = 0;

  for (const store of stores) {
    const storeStartedAt = Date.now();
    const sync = await syncCollectorStore(store, handlers);
    const persistence = await persistCollectedOffers(sync.offers);
    totalCollected += sync.offers.length;
    totalAccepted += persistence.accepted;
    totalRejected += persistence.rejected;

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
    },
    results,
    durationMs: Date.now() - startedAt,
    tavilyCalls: 0,
    note: isLocalDev
      ? 'Local batch sync: auth bypassed only outside production; Tavily is disabled.'
      : 'Production batch sync: CRON_SECRET required; Tavily is disabled.',
  });
}
