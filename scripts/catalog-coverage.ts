import { prisma } from '../lib/db.ts';
import { isRestrictedShoppingQuery } from '../lib/safety.ts';
import { createDefaultCollectorHandlers } from '../collector/default-handlers.ts';
import { persistCollectedOffers } from '../collector/canonical-bridge.ts';
import { syncCollectorStore } from '../collector/orchestrator.ts';
import { collectorStores, coreCollectorStoreSlugs } from '../collector/store-registry.ts';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. Run: set -a; source .env.local; set +a');
  process.exit(1);
}

const freshAfter = new Date(Date.now() - 48 * 60 * 60 * 1000);
const [recentSearches, families] = await Promise.all([
  prisma.searchLog.findMany({ orderBy: { createdAt: 'desc' }, take: 60, select: { query: true } }),
  prisma.productFamily.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    take: 120,
    select: {
      canonicalTitle: true,
      variants: {
        select: {
          offers: {
            where: {
              validationStatus: 'ACCEPTED',
              priceKind: 'ONE_TIME',
              totalPrice: { not: null },
              lastSeenAt: { gte: freshAfter },
            },
            select: { merchant: { select: { slug: true } } },
          },
        },
      },
    },
  }),
]);

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

const queryMap = new Map<string, string>();
for (const row of recentSearches) {
  const value = clean(row.query);
  if (value.length < 4 || isRestrictedShoppingQuery(value)) continue;
  queryMap.set(value.toLowerCase(), value);
}

for (const family of families) {
  const merchants = new Set(family.variants.flatMap((variant) => variant.offers.map((offer) => offer.merchant.slug)));
  if (merchants.size > 2) continue;
  const value = clean(family.canonicalTitle);
  if (value.length < 4 || isRestrictedShoppingQuery(value)) continue;
  queryMap.set(value.toLowerCase(), value);
}

const priorityQueries = [...queryMap.values()].slice(0, 30);
if (!priorityQueries.length) {
  console.error('No safe recent/low-coverage product queries available.');
  process.exit(0);
}

const stores = coreCollectorStoreSlugs
  .map((slug) => collectorStores.find((store) => store.slug === slug))
  .filter((store): store is NonNullable<typeof store> => Boolean(store));

console.error(`CENIQ coverage pass: ${priorityQueries.length} product queries across ${stores.length} core stores`);
console.error(priorityQueries.map((query, index) => `${index + 1}. ${query}`).join('\n'));

const handlers = createDefaultCollectorHandlers({
  maxSitemaps: 16,
  maxProductPages: Math.min(70, priorityQueries.length + 30),
  pageDelayMs: 160,
  pageTimeoutMs: 8_000,
  sourceBudgetMs: 55_000,
  sampleOffset: 0,
  priorityQueries,
});

const results = [];
for (const store of stores) {
  const startedAt = Date.now();
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
      durationMs: Date.now() - startedAt,
    };
    results.push(result);
    console.error(`${store.slug}: ${result.accepted}/${result.collected} accepted in ${(result.durationMs / 1000).toFixed(1)}s`);
  } catch (error) {
    const result = {
      store: store.slug,
      source: null,
      collected: 0,
      accepted: 0,
      rejected: 0,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
    results.push(result);
    console.error(`${store.slug}: ERROR ${result.error}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  priorityQueries: priorityQueries.length,
  stores: results.length,
  totalCollected: results.reduce((sum, row) => sum + row.collected, 0),
  totalAccepted: results.reduce((sum, row) => sum + row.accepted, 0),
  totalRejected: results.reduce((sum, row) => sum + row.rejected, 0),
  tavilyCalls: 0,
  dataForSeoCalls: 0,
  results,
}, null, 2));

await prisma.$disconnect();
