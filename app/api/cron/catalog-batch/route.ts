import { NextResponse } from 'next/server';
import { createDefaultCollectorHandlers } from '@/collector/default-handlers';
import { persistCollectedOffers } from '@/collector/canonical-bridge';
import { syncCollectorStore } from '@/collector/orchestrator';
import { collectorStores, coreCollectorStoreSlugs } from '@/collector/store-registry';
import type { CollectorStore } from '@/collector/types';

export const maxDuration = 300;

const DAY_MS = 86_400_000;
const MAX_STORES_PER_REQUEST = 6;

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
}

function rotatingStores(size: number, day: number) {
  if (!collectorStores.length) return [];
  const start = (day * size) % collectorStores.length;
  return Array.from({ length: Math.min(size, collectorStores.length) }, (_, index) =>
    collectorStores[(start + index) % collectorStores.length],
  );
}

function resolveStores(url: URL) {
  const raw = (url.searchParams.get('stores') || 'core').trim().toLowerCase();
  const day = Math.floor(Date.now() / DAY_MS);

  if (raw === 'rotation') {
    const size = clampInt(url.searchParams.get('storeLimit'), MAX_STORES_PER_REQUEST, 1, MAX_STORES_PER_REQUEST);
    return { stores: rotatingStores(size, day), unknownStores: [] as string[], mode: 'rotation' as const, day };
  }

  const requested = raw === 'core'
    ? [...coreCollectorStoreSlugs]
    : raw.split(',').map((value) => value.trim()).filter(Boolean);
  const uniqueSlugs = [...new Set(requested)].slice(0, MAX_STORES_PER_REQUEST);
  const stores = uniqueSlugs
    .map((slug) => collectorStores.find((store) => store.slug === slug))
    .filter((store): store is CollectorStore => Boolean(store));
  const unknownStores = uniqueSlugs.filter((slug) => !stores.some((store) => store.slug === slug));
  return { stores, unknownStores, mode: 'explicit' as const, day };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker()));
  return results;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  const isLocalDev = process.env.NODE_ENV !== 'production';
  if (!isLocalDev && (!secret || auth !== `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const selection = resolveStores(url);
  if (!selection.stores.length) {
    return NextResponse.json({ error: 'No valid collector stores selected', unknownStores: selection.unknownStores }, { status: 400 });
  }

  const limit = clampInt(url.searchParams.get('limit'), 40, 1, 60);
  const concurrency = clampInt(url.searchParams.get('concurrency'), 3, 1, 3);
  const rawCursor = url.searchParams.get('cursor');
  const cursor = rawCursor == null
    ? selection.mode === 'rotation'
      ? selection.day * limit
      : 0
    : clampInt(rawCursor, 0, 0, 10_000_000);

  const handlers = createDefaultCollectorHandlers({
    maxSitemaps: 12,
    maxProductPages: limit,
    pageDelayMs: 180,
    pageTimeoutMs: 8_000,
    sourceBudgetMs: 38_000,
    sampleOffset: cursor,
    priorityQueries: cursor === 0
      ? ['Samsung Galaxy S25', 'iPhone 16', 'Sony WH-1000XM5', 'Lenovo Legion 5', 'LG OLED C4', 'Canon EOS R50', 'Epson EcoTank L3250']
      : [],
  });

  const startedAt = Date.now();
  const results = await mapWithConcurrency(selection.stores, concurrency, async (store) => {
    const storeStartedAt = Date.now();
    try {
      const sync = await syncCollectorStore(store, handlers);
      const persistence = await persistCollectedOffers(sync.offers);
      return {
        store: { slug: store.slug, name: store.name },
        selectedSource: sync.selectedSource || null,
        offersCollected: sync.offers.length,
        persisted: {
          examined: persistence.examined,
          accepted: persistence.accepted,
          rejected: persistence.rejected,
          rejectionReasons: persistence.rejectionReasons,
        },
        attempts: sync.attempts,
        durationMs: Date.now() - storeStartedAt,
      };
    } catch (error) {
      return {
        store: { slug: store.slug, name: store.name },
        selectedSource: null,
        offersCollected: 0,
        persisted: { examined: 0, accepted: 0, rejected: 0, rejectionReasons: {} as Record<string, number> },
        attempts: [],
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - storeStartedAt,
      };
    }
  });

  let totalCollected = 0;
  let totalAccepted = 0;
  let totalRejected = 0;
  let urlsDiscovered = 0;
  let productPagesExamined = 0;
  const rejectionReasons: Record<string, number> = {};

  for (const result of results) {
    totalCollected += result.offersCollected;
    totalAccepted += result.persisted.accepted;
    totalRejected += result.persisted.rejected;
    for (const attempt of result.attempts) {
      urlsDiscovered += attempt.discovered || 0;
      productPagesExamined += attempt.examined || 0;
      for (const [reason, count] of Object.entries(attempt.rejectionReasons || {})) {
        rejectionReasons[reason] = (rejectionReasons[reason] || 0) + Number(count || 0);
      }
    }
    for (const [reason, count] of Object.entries(result.persisted.rejectionReasons || {})) {
      rejectionReasons[reason] = (rejectionReasons[reason] || 0) + Number(count || 0);
    }
    if ('error' in result && result.error) rejectionReasons['store-run-error'] = (rejectionReasons['store-run-error'] || 0) + 1;
  }

  const durationMs = Date.now() - startedAt;
  return NextResponse.json({
    ok: true,
    mode: selection.mode,
    storesRequested: selection.stores.map((store) => store.slug),
    unknownStores: selection.unknownStores,
    summary: {
      storesRun: selection.stores.length,
      storesWithOffers: results.filter((result) => result.offersCollected > 0).length,
      storesAccepted: results.filter((result) => result.persisted.accepted > 0).length,
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
    durationMs,
    tavilyCalls: 0,
    dataForSeoCalls: 0,
    cursor,
    nextCursor: cursor + limit,
    limit,
    concurrency,
    note: isLocalDev
      ? 'Local batch sync: auth bypassed only outside production; paid discovery is disabled.'
      : 'Production batch sync: CRON_SECRET required; paid discovery is disabled.',
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
