import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDiscoveryDomains } from '../collector/discovery.ts';

test('explicit discovery domain clusters override the global merchant allowlist', () => {
  const domains = resolveDiscoveryDomains({
    knownMerchantsOnly: true,
    includeDomains: ['https://220.lv', 'www.dateks.lv', 'https://evelatus.lv/path'],
  });
  assert.deepEqual(domains.sort(), ['220.lv','dateks.lv','evelatus.lv'].sort());
});

test('discovery domain clusters honor explicit exclusions', () => {
  const domains = resolveDiscoveryDomains({
    knownMerchantsOnly: true,
    includeDomains: ['220.lv','dateks.lv','evelatus.lv'],
    excludeDomains: ['https://dateks.lv'],
  });
  assert.deepEqual(domains.sort(), ['220.lv','evelatus.lv'].sort());
});

import { discoverProductUrls } from '../collector/discovery.ts';
test('provider fallback never retries Tavily within one discovery invocation',async()=>{
 const original=globalThis.fetch,oldTavily=process.env.TAVILY_API_KEY,oldBrave=process.env.BRAVE_SEARCH_API_KEY;
 process.env.TAVILY_API_KEY='test';process.env.BRAVE_SEARCH_API_KEY='test';let tavily=0,brave=0;
 globalThis.fetch=async(input)=>{String(input).includes('tavily')?tavily++:brave++;return new Response('{}',{status:503});};
 try{await assert.rejects(()=>discoverProductUrls('Samsung Galaxy S25',{knownMerchantsOnly:true,includeDomains:['tet.lv']}));assert.equal(tavily,1);assert.equal(brave,1);}
 finally{globalThis.fetch=original;if(oldTavily===undefined)delete process.env.TAVILY_API_KEY;else process.env.TAVILY_API_KEY=oldTavily;if(oldBrave===undefined)delete process.env.BRAVE_SEARCH_API_KEY;else process.env.BRAVE_SEARCH_API_KEY=oldBrave;}
});
