import { NextResponse } from 'next/server';
import { createDefaultCollectorHandlers } from '@/collector/default-handlers';
import { persistCollectedOffers } from '@/collector/canonical-bridge';
import { syncCollectorStore } from '@/collector/orchestrator';
import { getCollectorStore } from '@/collector/store-registry';

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  const isLocalDev = process.env.NODE_ENV !== 'production';
  if (!isLocalDev && (!secret || auth !== `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const storeSlug = (url.searchParams.get('store') || 'bite').trim().toLowerCase();
  const requestedLimit = Number(url.searchParams.get('limit') || 12);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 12, 1), 20);
  const store = getCollectorStore(storeSlug);

  if (!store) {
    return NextResponse.json({ error: 'Unknown collector store', store: storeSlug }, { status: 400 });
  }

  const startedAt = Date.now();
  const handlers = createDefaultCollectorHandlers({
    maxSitemaps: 12,
    maxProductPages: limit,
    pageDelayMs: 300,
  });

  const sync = await syncCollectorStore(store, handlers);
  const persistence = await persistCollectedOffers(sync.offers);

  return NextResponse.json({
    ok: true,
    store: { slug: store.slug, name: store.name },
    selectedSource: sync.selectedSource || null,
    offersCollected: sync.offers.length,
    persisted: {
      examined: persistence.examined,
      accepted: persistence.accepted,
      rejected: persistence.rejected,
    },
    attempts: sync.attempts,
    durationMs: Date.now() - startedAt,
    tavilyCalls: 0,
    note: isLocalDev
      ? 'Local dev sync: auth bypassed only outside production; Tavily is disabled.'
      : 'Production sync: CRON_SECRET required; Tavily is disabled.',
  });
}
