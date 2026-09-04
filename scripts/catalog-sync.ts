import { createDefaultCollectorHandlers } from '../collector/default-handlers.ts';
import { persistCollectedOffers } from '../collector/canonical-bridge.ts';
import { syncCollectorStore } from '../collector/orchestrator.ts';
import { collectorStores, coreCollectorStoreSlugs } from '../collector/store-registry.ts';
import type { CollectorStore } from '../collector/types.ts';

function arg(name: string) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function integer(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
}

function resolveStores(): CollectorStore[] {
  const raw = (arg('stores') || 'core').trim().toLowerCase();
  const slugs = raw === 'core' ? [...coreCollectorStoreSlugs] : raw.split(',').map((value) => value.trim()).filter(Boolean);
  const unique = [...new Set(slugs)].slice(0, 12);
  const stores = unique.map((slug) => collectorStores.find((store) => store.slug === slug)).filter((store): store is CollectorStore => Boolean(store));
  const missing = unique.filter((slug) => !stores.some((store) => store.slug === slug));
  if (missing.length) console.error(`Unknown stores ignored: ${missing.join(', ')}`);
  return stores;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker()));
  return results;
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. In Codespaces run: set -a; source .env.local; set +a');
  process.exit(1);
}

const stores = resolveStores();
if (!stores.length) {
  console.error('No valid stores selected.');
  process.exit(1);
}

const limit = integer(arg('limit'), 40, 1, 80);
const cursor = integer(arg('cursor'), 0, 0, 10_000_000);
const concurrency = integer(arg('concurrency'), 3, 1, 3);
const startedAt = Date.now();
const handlers = createDefaultCollectorHandlers({
  maxSitemaps: 12,
  maxProductPages: limit,
  pageDelayMs: 180,
  pageTimeoutMs: 8_000,
  sourceBudgetMs: 45_000,
  sampleOffset: cursor,
  priorityQueries: cursor === 0
    ? ['Samsung Galaxy S25', 'iPhone 16', 'Sony WH-1000XM5', 'Lenovo Legion 5', 'LG OLED C4']
    : [],
});

console.error(`CENIQ sync: ${stores.map((store) => store.slug).join(', ')} | limit=${limit} cursor=${cursor} concurrency=${concurrency}`);

const results = await mapWithConcurrency(stores, concurrency, async (store) => {
  const storeStartedAt = Date.now();
  try {
    const sync = await syncCollectorStore(store, handlers);
    const persisted = await persistCollectedOffers(sync.offers);
    const result = {
      store: store.slug,
      source: sync.selectedSource || null,
      collected: sync.offers.length,
      accepted: persisted.accepted,
      rejected: persisted.rejected,
      rejectionReasons: persisted.rejectionReasons,
      attempts: sync.attempts,
      durationMs: Date.now() - storeStartedAt,
    };
    console.error(`${store.slug}: ${result.accepted}/${result.collected} accepted in ${(result.durationMs / 1000).toFixed(1)}s`);
    return result;
  } catch (error) {
    const result = {
      store: store.slug,
      source: null,
      collected: 0,
      accepted: 0,
      rejected: 0,
      rejectionReasons: { 'store-run-error': 1 },
      attempts: [],
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - storeStartedAt,
    };
    console.error(`${store.slug}: ERROR ${result.error}`);
    return result;
  }
});

const summary = {
  storesRun: results.length,
  storesWithOffers: results.filter((result) => result.collected > 0).length,
  storesAccepted: results.filter((result) => result.accepted > 0).length,
  totalCollected: results.reduce((sum, result) => sum + result.collected, 0),
  totalAccepted: results.reduce((sum, result) => sum + result.accepted, 0),
  totalRejected: results.reduce((sum, result) => sum + result.rejected, 0),
  durationMs: Date.now() - startedAt,
  tavilyCalls: 0,
  dataForSeoCalls: 0,
  cursor,
  nextCursor: cursor + limit,
};

console.log(JSON.stringify({ ok: true, summary, results }, null, 2));
