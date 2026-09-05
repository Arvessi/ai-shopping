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
const MAX_PAGES_PER_CALL = 12;
const MAX_PRODUCT_QUERIES = 4;
const freshAfter = new Date(Date.now() - 48 * 60 * 60 * 1000);

const genericQueries = new Set([
  'sports','toys','laptop','headphones','smartphone','phone','tv','gaming','monitor','camera','bike','beauty','home appliance',
]);
const ACCESSORY = /\b(?:case|cover|screen\s*protector|protective|tempered\s*glass|glass|charger|adapter|cable|holder|maci[nņ]s|vaci[nņ]s|apvalks|aizsargstikls|stikls|vāciņš|maciņš)\b/i;
const CONDITION = /\b(?:izpakota|izpakots|refurb(?:ished)?|lietota|lietots|used|demo)\b/i;
const STOP = new Set(['the','for','with','and','un','ar','new','jauns','jauna','phone','smartphone','mobile','5g','4g','galaxy','apple','samsung']);

const MERCHANT_CLUSTERS = [
  { name:'major-gaps', slugs:['220','1a','dateks','aio','balticdata','tet','evelatus'] },
  { name:'long-tail-gaps', slugs:['tehnoland','707','dato','upgreat','24lv','need','cenuklubs'] },
] as const;

const COLLECTOR_SLUG_ALIASES: Record<string,string> = {
  '24lv': '24',
};

function clean(value:string) {
  return value.replace(/\s+/g,' ').replace(/\s*\/\s*$/g,'').trim();
}
function normalize(value:string) {
  return clean(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
function isSpecificProductQuery(value:string) {
  const q=clean(value);
  if(q.length<5||genericQueries.has(q.toLowerCase())||isRestrictedShoppingQuery(q)||ACCESSORY.test(q)) return false;
  if(/\d/.test(q)) return true;
  return /\b[A-Z]{2,}[A-Z0-9-]{2,}\b/.test(q);
}
function tokens(value:string) {
  return normalize(value).split(' ').filter(token=>token.length>=2&&!STOP.has(token));
}
function phoneIdentity(value:string) {
  const iphone=value.match(/\biphone\s+(\d{1,2})(?:\s*(e)|\s+(pro\s+max|pro|plus|air|mini|se))?/i);
  if(iphone) return `iphone:${iphone[1]}:${(iphone[2]||iphone[3]||'base').toLowerCase().replace(/\s+/g,'')}`;
  const galaxy=value.match(/\bgalaxy\s+([a-z]\d{1,3})(?:\s+(ultra|plus|fe))?/i);
  if(galaxy) return `galaxy:${galaxy[1].toLowerCase()}:${(galaxy[2]||'base').toLowerCase()}`;
  return '';
}
function looksRelevant(title:string,query:string) {
  if(!ACCESSORY.test(query)&&ACCESSORY.test(title)) return false;
  if(CONDITION.test(title)!==CONDITION.test(query)) return false;
  const wantedPhone=phoneIdentity(query);
  if(wantedPhone&&phoneIdentity(title)!==wantedPhone) return false;

  const wanted=tokens(query);
  if(!wanted.length) return false;
  const haystack=new Set(tokens(title));
  const matches=wanted.filter(token=>haystack.has(token)).length;
  const required=wanted.length<=3?wanted.length:Math.max(3,Math.ceil(wanted.length*.72));
  return matches>=required;
}
function hostname(value:string) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./,''); }
  catch { return ''; }
}
function queryMatchesTitle(query:string,title:string) {
  const wanted=tokens(query);
  const haystack=normalize(title);
  return wanted.length>0&&wanted.every(token=>haystack.includes(token));
}

const families=await prisma.productFamily.findMany({
  where:{status:'ACTIVE'},
  orderBy:{updatedAt:'desc'},
  take:220,
  select:{
    canonicalTitle:true,
    variants:{
      select:{
        offers:{
          where:{
            validationStatus:'ACCEPTED',
            priceKind:'ONE_TIME',
            totalPrice:{not:null},
            lastSeenAt:{gte:freshAfter},
          },
          select:{merchant:{select:{slug:true}}},
        },
      },
    },
  },
});
const recent=await prisma.searchLog.findMany({
  orderBy:{createdAt:'desc'},
  take:100,
  select:{query:true},
});

const familyCoverage=families.map(family=>({
  title:family.canonicalTitle,
  merchants:new Set(family.variants.flatMap(variant=>variant.offers.map(offer=>offer.merchant.slug))).size,
}));

const candidates=new Map<string,string>();

for(const row of recent) {
  const q=clean(row.query);
  if(!isSpecificProductQuery(q)) continue;
  const matches=familyCoverage.filter(family=>queryMatchesTitle(q,family.title));
  const bestCoverage=matches.length?Math.max(...matches.map(family=>family.merchants)):0;
  if(bestCoverage>2) continue;
  if(!candidates.has(q.toLowerCase())) candidates.set(q.toLowerCase(),q);
}

for(const family of familyCoverage) {
  if(family.merchants>2) continue;
  const q=clean(family.title);
  if(isSpecificProductQuery(q)&&!candidates.has(q.toLowerCase())) candidates.set(q.toLowerCase(),q);
}

const priorityQueries=[...candidates.values()].slice(0,MAX_PRODUCT_QUERIES);
if(!priorityQueries.length) {
  console.error('No low-coverage specific product queries available for Tavily.');
  await prisma.$disconnect();
  process.exit(0);
}

const nativeMerchants=discoveryMerchants.filter(merchant=>merchant.market==='LV'&&merchant.deliveryToLatvia==='native');
const merchantBySlug=new Map(nativeMerchants.map(merchant=>[merchant.slug,merchant]));
const collectorBySlug=new Map(collectorStores.map(store=>[store.slug,store]));

let tavilyCalls=0;
let usageCredits=0;
const allOffers:CollectedOffer[]=[];
const queryResults:any[]=[];

console.error(`CENIQ Tavily gap fill: ${priorityQueries.length} low-coverage products × ${MERCHANT_CLUSTERS.length} merchant clusters (hard max ${MAX_TAVILY_CALLS})`);

for(const query of priorityQueries) {
  for(const cluster of MERCHANT_CLUSTERS) {
    if(tavilyCalls>=MAX_TAVILY_CALLS) break;

    const clusterSlugs = new Set<string>(cluster.slugs);
    const merchants=cluster.slugs
      .map(slug=>merchantBySlug.get(slug))
      .filter(Boolean) as NonNullable<ReturnType<typeof merchantBySlug.get>>[];
    const includeDomains=merchants.map(merchant=>hostname(merchant.origin)).filter(Boolean);

    console.error(`${tavilyCalls+1}. ${query} → ${cluster.name} (${includeDomains.join(', ')})`);
    try {
      tavilyCalls+=1;
      const discovered=await discoverProductUrls(`${query} cena pirkt`,{
        maxResults:MAX_RESULTS_PER_QUERY,
        knownMerchantsOnly:true,
        country:'latvia',
        language:'lv',
        includeDomains,
      });
      usageCredits+=discovered.usageCredits||0;

      const seen=new Set<string>();
      const urls=discovered.candidates
        .filter(candidate=>Boolean(candidate.merchantSlug&&clusterSlugs.has(candidate.merchantSlug)))
        .filter(candidate=>{
          if(seen.has(candidate.url)) return false;
          seen.add(candidate.url);
          return true;
        })
        .slice(0,MAX_PAGES_PER_CALL);

      const queryOffers:CollectedOffer[]=[];
      const fetchFailures:string[]=[];
      for(const candidate of urls) {
        const discoveredSlug=candidate.merchantSlug!;
        const collectorSlug=COLLECTOR_SLUG_ALIASES[discoveredSlug]||discoveredSlug;
        const store=collectorBySlug.get(collectorSlug);
        if(!store) continue;
        try {
          const html=await fetchText(candidate.url,9000);
          const parsed=parseProductPage(html,candidate.url,store);
          if(parsed&&looksRelevant(parsed.title,query)) queryOffers.push(parsed);
        } catch(error) {
          fetchFailures.push(discoveredSlug);
        }
        await sleep(120);
      }

      allOffers.push(...queryOffers);
      queryResults.push({
        query,
        cluster:cluster.name,
        domains:includeDomains,
        discovered:discovered.candidates.length,
        examined:urls.length,
        parsed:queryOffers.length,
        merchants:[...new Set(queryOffers.map(offer=>offer.merchantSlug))],
        fetchFailures:[...new Set(fetchFailures)],
      });
      console.error(`   ${queryOffers.length} validated offers from ${urls.length} pages · ${[...new Set(queryOffers.map(offer=>offer.merchantSlug))].join(', ')||'no new merchants'}`);
    } catch(error) {
      queryResults.push({
        query,
        cluster:cluster.name,
        discovered:0,
        examined:0,
        parsed:0,
        error:error instanceof Error?error.message:String(error),
      });
      console.error(`   ERROR ${error instanceof Error?error.message:String(error)}`);
    }
  }
}

const uniqueOffers=[...new Map(allOffers.map(offer=>[`${offer.merchantSlug}|${offer.url}`,offer])).values()];
const persisted=await persistCollectedOffers(uniqueOffers);

console.log(JSON.stringify({
  ok:true,
  strategy:'low-coverage-domain-scoped-gap-fill',
  tavilyCalls,
  usageCredits,
  productQueries:priorityQueries.length,
  merchantClusters:MERCHANT_CLUSTERS.map(cluster=>cluster.name),
  discoveredValidatedOffers:uniqueOffers.length,
  accepted:persisted.accepted,
  rejected:persisted.rejected,
  rejectionReasons:persisted.rejectionReasons,
  dataForSeoCalls:0,
  newMerchants:[...new Set(uniqueOffers.map(offer=>offer.merchantSlug))],
  queryResults,
},null,2));

await prisma.$disconnect();