import { prisma } from '../lib/db.ts';
import { isRestrictedShoppingQuery } from '../lib/safety.ts';
import { discoverProductUrls } from '../collector/discovery.ts';
import { discoveryMerchants } from '../collector/discovery-merchants.ts';
import { fetchText, sleep } from '../collector/http.ts';

if(!process.env.DATABASE_URL){console.error('DATABASE_URL is missing.');process.exit(1);}
if(!process.env.TAVILY_API_KEY){console.error('TAVILY_API_KEY is missing.');process.exit(1);}

const MAX_CALLS=4;
const FOREIGN=discoveryMerchants.filter(m=>m.market!=='LV'&&m.deliveryToLatvia==='verify');
const GENERIC=new Set(['sports','toys','laptop','headphones','smartphone','phone','tv','gaming','monitor','camera']);
const ACCESSORY=/\b(?:case|cover|protector|glass|charger|adapter|cable|holder|maci[nņ]s|vaci[nņ]s|apvalks|aizsargstikls)\b/i;
const DELIVERY_TO_LATVIA=/(?:deliver(?:y|ed)?|shipping|ship|pristat\w*|pieg[aā]d\w*)[^.\n]{0,90}(?:latvia|latvij[aā])|(?:latvia|latvij[aā])[^.\n]{0,90}(?:deliver(?:y|ed)?|shipping|ship|pristat\w*|pieg[aā]d\w*)/i;

function host(value:string){try{return new URL(value).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}}
function specific(value:string){const q=value.trim();return q.length>=5&&!GENERIC.has(q.toLowerCase())&&!ACCESSORY.test(q)&&!isRestrictedShoppingQuery(q)&&/\d/.test(q);}

const recent=await prisma.searchLog.findMany({orderBy:{createdAt:'desc'},take:50,select:{query:true}});
const queries=[...new Map(recent.filter(r=>specific(r.query)).map(r=>[r.query.toLowerCase(),r.query.trim()])).values()].slice(0,MAX_CALLS);
const includeDomains=FOREIGN.map(m=>host(m.origin)).filter(Boolean);
let calls=0;let usageCredits=0;const results:any[]=[];
console.error(`CENIQ Baltic probe: ${queries.length} non-persisting searches across ${includeDomains.length} LT/EE domains`);
for(const query of queries){
  calls+=1;
  try{
    const discovered=await discoverProductUrls(`${query} delivery Latvia`,{maxResults:12,knownMerchantsOnly:true,country:'latvia',language:'en',includeDomains});
    usageCredits+=discovered.usageCredits||0;
    const eligible:any[]=[];
    for(const candidate of discovered.candidates.slice(0,8)){
      try{
        const html=await fetchText(candidate.url,8000);
        const text=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
        if(DELIVERY_TO_LATVIA.test(text)){ eligible.push({merchant:candidate.merchantSlug,domain:candidate.domain,url:candidate.url,title:candidate.title}); }
      }catch{}
      await sleep(120);
    }
    results.push({query,discovered:discovered.candidates.length,deliveryVerifiedCandidates:eligible});
    console.error(`${query}: ${eligible.length} pages with explicit Latvia-delivery wording`);
  }catch(error){results.push({query,error:error instanceof Error?error.message:String(error)});}
}
console.log(JSON.stringify({ok:true,persisted:false,reason:'Foreign offers are never surfaced until Latvia delivery is explicitly verified.',tavilyCalls:calls,usageCredits,foreignDomains:includeDomains,results},null,2));
await prisma.$disconnect();
