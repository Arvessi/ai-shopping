import { collectorStores } from '../collector/store-registry.ts';
import { fetchText, sleep } from '../collector/http.ts';
import { parseMerchantXmlFeed } from '../collector/feed.ts';
import { persistCollectedOffers } from '../collector/canonical-bridge.ts';
import type { CollectedOffer, CollectorStore } from '../collector/types.ts';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. Run: set -a; source .env.local; set +a');
  process.exit(1);
}

const TARGETS = new Set([
  '220','1a','dateks','aio','balticdata','tet','evelatus','tehnoland','707','dato','upgreat','24','need','cenuklubs',
]);
const CANDIDATE_PATHS = [
  '/feed.xml',
  '/products.xml',
  '/product-feed.xml',
  '/salidzini.xml',
  '/kurpirkt.xml',
  '/xml/products.xml',
  '/export/products.xml',
];
const MAX_STORES = 14;
const MIN_VALID_OFFERS = 3;

function hostname(value:string) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./,''); }
  catch { return ''; }
}
function sameMerchantHost(url:string,store:CollectorStore) {
  const offerHost=hostname(url);
  const storeHost=hostname(store.origin);
  return Boolean(offerHost&&storeHost&&(offerHost===storeHost||offerHost.endsWith(`.${storeHost}`)||storeHost.endsWith(`.${offerHost}`)));
}

const stores=collectorStores.filter(store=>TARGETS.has(store.slug)).slice(0,MAX_STORES);
const acceptedOffers:CollectedOffer[]=[];
const results:Array<Record<string,unknown>>=[];

console.error(`CENIQ public feed probe: ${stores.length} merchants · 0 paid API calls`);
for (const store of stores) {
  let found=false;
  let attempts=0;
  for (const path of CANDIDATE_PATHS) {
    if (found) break;
    attempts+=1;
    const url=new URL(path,store.origin).toString();
    try {
      const xml=await fetchText(url,6500);
      if (!/^\s*</.test(xml) || !/(<product\b|<item\b|<offer\b|<entry\b)/i.test(xml)) continue;
      const parsed=parseMerchantXmlFeed(xml,store);
      const offers=parsed.offers.filter(offer=>sameMerchantHost(offer.url,store));
      if (offers.length<MIN_VALID_OFFERS) continue;
      acceptedOffers.push(...offers);
      results.push({store:store.slug,feed:url,totalItems:parsed.totalItems,validOffers:offers.length,rejected:parsed.rejected,attempts});
      console.error(`✓ ${store.slug}: ${offers.length} valid offers · ${url}`);
      found=true;
    } catch {}
    await sleep(Math.max(350,Math.min(store.crawlDelayMs||700,1200)));
  }
  if (!found) {
    results.push({store:store.slug,feed:null,validOffers:0,attempts});
    console.error(`· ${store.slug}: no conventional public XML feed found`);
  }
}

const unique=[...new Map(acceptedOffers.map(offer=>[`${offer.merchantSlug}|${offer.url}`,offer])).values()];
const persisted=unique.length?await persistCollectedOffers(unique):{accepted:0,rejected:0,rejectionReasons:{}};
console.log(JSON.stringify({
  ok:true,
  strategy:'public-conventional-feed-probe',
  paidProviderCalls:0,
  stores:stores.length,
  feedsFound:results.filter(row=>row.feed).length,
  discoveredOffers:unique.length,
  accepted:persisted.accepted,
  rejected:persisted.rejected,
  rejectionReasons:persisted.rejectionReasons,
  results,
},null,2));
