import { prisma } from '../lib/db.ts';
import { isRestrictedShoppingQuery } from '../lib/safety.ts';
import { discoverProductUrls } from '../collector/discovery.ts';
import { discoveryMerchants } from '../collector/discovery-merchants.ts';
import { collectorStores } from '../collector/store-registry.ts';
import { fetchText, sleep } from '../collector/http.ts';
import { parseProductPage } from '../collector/product-page.ts';
import { persistCollectedOffers } from '../collector/canonical-bridge.ts';
import type { CollectedOffer } from '../collector/types.ts';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. Run: set -a; source .env.local; set +a');
  process.exit(1);
}
if (!process.env.TAVILY_API_KEY) {
  console.error('TAVILY_API_KEY is missing. Tavily gap fill was not started.');
  process.exit(1);
}

const MAX_TAVILY_CALLS = 8;
const MAX_RESULTS_PER_QUERY = 20;
const MAX_PAGES_PER_QUERY = 12;
const freshAfter = new Date(Date.now() - 48 * 60 * 60 * 1000);
const genericQueries = new Set(['sports','toys','laptop','headphones','smartphone','phone','tv','gaming','monitor','camera','bike','beauty','home appliance']);

function clean(value: string) {
  return value.replace(/\s+/g, ' ').replace(/\s*\/\s*$/g, '').trim();
}
function isSpecificProductQuery(value: string) {
  const q = clean(value);
  if (q.length < 5 || genericQueries.has(q.toLowerCase()) || isRestrictedShoppingQuery(q)) return false;
  if (/\d/.test(q)) return true;
  return /\b[A-Z]{2,}[A-Z0-9-]{2,}\b/.test(q);
}
function tokens(value: string) {
  return value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length >= 2) || [];
}
function looksRelevant(title: string, query: string) {
  const wanted = tokens(query);
  if (!wanted.length) return false;
  const haystack = tokens(title);
  const matches = wanted.filter((token) => haystack.includes(token)).length;
  return matches >= Math.max(2, Math.ceil(wanted.length * 0.55));
}

const families = await prisma.productFamily.findMany({
  where: { status: 'ACTIVE' },
  orderBy: { updatedAt: 'desc' },
  take: 160,
  select: {
    canonicalTitle: true,
    variants: {
      select: {
        offers: {
          where: { validationStatus: 'ACCEPTED', priceKind: 'ONE_TIME', totalPrice: { not: null }, lastSeenAt: { gte: freshAfter } },
          select: { merchant: { select: { slug: true } } },
        },
      },
    },
  },
});
const recent = await prisma.searchLog.findMany({ orderBy: { createdAt: 'desc' }, take: 80, select: { query: true } });

const candidates = new Map<string, string>();
for (const family of families) {
  const merchantCount = new Set(family.variants.flatMap((variant) => variant.offers.map((offer) => offer.merchant.slug))).size;
  if (merchantCount > 2) continue;
  const q = clean(family.canonicalTitle);
  if (isSpecificProductQuery(q)) candidates.set(q.toLowerCase(), q);
}
for (const row of recent) {
  const q = clean(row.query);
  if (isSpecificProductQuery(q) && !candidates.has(q.toLowerCase())) candidates.set(q.toLowerCase(), q);
}

const priorityQueries = [...candidates.values()].slice(0, MAX_TAVILY_CALLS);
if (!priorityQueries.length) {
  console.error('No low-coverage specific product queries available for Tavily.');
  await prisma.$disconnect();
  process.exit(0);
}

const merchantBySlug = new Map(discoveryMerchants.filter((merchant) => merchant.market === 'LV' && merchant.deliveryToLatvia === 'native').map((merchant) => [merchant.slug, merchant]));
const collectorBySlug = new Map(collectorStores.map((store) => [store.slug, store]));
let tavilyCalls = 0;
let usageCredits = 0;
const allOffers: CollectedOffer[] = [];
const queryResults = [];

console.error(`CENIQ Tavily coverage: ${priorityQueries.length} bounded queries (hard max ${MAX_TAVILY_CALLS})`);
for (const [index, query] of priorityQueries.entries()) {
  console.error(`${index + 1}. ${query}`);
  try {
    tavilyCalls += 1;
    const discovered = await discoverProductUrls(query, { maxResults: MAX_RESULTS_PER_QUERY, knownMerchantsOnly: true, country: 'latvia', language: 'lv' });
    usageCredits += discovered.usageCredits || 0;
    const seen = new Set<string>();
    const urls = discovered.candidates
      .filter((candidate) => candidate.merchantSlug && merchantBySlug.has(candidate.merchantSlug))
      .filter((candidate) => {
        if (seen.has(candidate.url)) return false;
        seen.add(candidate.url);
        return true;
      })
      .slice(0, MAX_PAGES_PER_QUERY);

    const queryOffers: CollectedOffer[] = [];
    for (const candidate of urls) {
      const store = collectorBySlug.get(candidate.merchantSlug!);
      if (!store) continue;
      try {
        const html = await fetchText(candidate.url, 8_000);
        const parsed = parseProductPage(html, candidate.url, store);
        if (parsed && looksRelevant(parsed.title, query)) queryOffers.push(parsed);
      } catch {
        // Discovery is opportunistic. A blocked/stale candidate is simply ignored.
      }
      await sleep(120);
    }
    allOffers.push(...queryOffers);
    queryResults.push({ query, discovered: discovered.candidates.length, examined: urls.length, parsed: queryOffers.length });
    console.error(`   ${queryOffers.length} validated offers from ${urls.length} pages`);
  } catch (error) {
    queryResults.push({ query, discovered: 0, examined: 0, parsed: 0, error: error instanceof Error ? error.message : String(error) });
    console.error(`   ERROR ${error instanceof Error ? error.message : String(error)}`);
  }
}

const uniqueOffers = [...new Map(allOffers.map((offer) => [`${offer.merchantSlug}|${offer.url}`, offer])).values()];
const persisted = await persistCollectedOffers(uniqueOffers);

console.log(JSON.stringify({
  ok: true,
  tavilyCalls,
  usageCredits,
  queries: priorityQueries.length,
  discoveredValidatedOffers: uniqueOffers.length,
  accepted: persisted.accepted,
  rejected: persisted.rejected,
  rejectionReasons: persisted.rejectionReasons,
  dataForSeoCalls: 0,
  queryResults,
}, null, 2));

await prisma.$disconnect();
