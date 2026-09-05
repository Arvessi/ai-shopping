import assert from 'node:assert/strict';
import test from 'node:test';
import {sameProduct} from '../collector/relevance.ts';
import {adapterProductLinks,parseMerchantPage} from '../collector/merchant-adapters.ts';
import {getCollectorStore} from '../collector/store-registry.ts';
test('enrichment preserves numeric phone identity, accessories and condition',()=>{
 for(const [title,query] of [['Galaxy S25 Ultra','Galaxy S25'],['Galaxy S25 FE','Galaxy S25'],['Galaxy S25+','Galaxy S25'],['iPhone 16e','iPhone 16'],['iPhone 16 Pro Max','iPhone 16'],['Cover for Honor 400 Lite','Honor 400 Lite'],['Honor 200 Lite','Honor 400 Lite'],['Galaxy S25 refurbished','Galaxy S25'],['Galaxy S25 used','Galaxy S25 refurbished']])assert.equal(sameProduct(title,query),false,`${title} / ${query}`);
 assert.equal(sameProduct('Samsung Galaxy S25 12+128GB Navy','Samsung Galaxy S25'),true);assert.equal(sameProduct('HONOR 400 Lite Dual Sim 256GB','Honor 400 Lite'),true);
});
test('merchant registry discovers exact product URLs and rejects external links',()=>{
 const sources=[['dateks','https://www.dateks.lv/cenas/viedtalruni/1249417-samsung-galaxy-s25'],['1a','https://www.1a.lv/p/galaxy-s25/wgae'],['aio','https://aio.lv/lv/product--samsung-s25--11255904'],['tet','https://www.tet.lv/veikals/viedtalruni/galaxy-s25.html'],['220','https://220.lv/lv/mobilie-telefoni/galaxy-s25?id=68347003']];
 for(const [slug,url] of sources){const store=getCollectorStore(slug)!;assert.deepEqual(adapterProductLinks(`<a href="${url}">phone</a><a href="https://evil.example/p/phone/123">bad</a><a href="/login">login</a>`,store.origin,store),[url]);}
});
test('Tet structured gross offer wins over credit and net prices; missing SKU uses MPN',()=>{
 const store=getCollectorStore('tet')!,url='https://www.tet.lv/veikals/viedtalruni/galaxy-s25.html';
 const html='<h1>Samsung Galaxy S25</h1><p>Tehnisku iemeslu dēļ</p><p>27,20 €/mēn. Cena bez PVN 709,92 €</p><script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Samsung Galaxy S25 12+128GB Navy',mpn:'SM-S931BDBDEUE',offers:{'@type':'Offer',price:859,priceCurrency:'EUR'}})+'</script>';
 const offer=parseMerchantPage(html,url,store);assert.equal(offer?.price,859);assert.equal(offer?.sku,'SM-S931BDBDEUE');assert.equal(parseMerchantPage('<h1>Galaxy S25</h1><p>SKU: S931 Price: 27.20 €</p>',url,store),null);
});

test('structured adapters reject unrelated Organization data beside an installment price',()=>{
 const html='<h1>Samsung Galaxy S25</h1><p>SKU: S931 Price: 27.20 €</p><script type="application/ld+json">{"@type":"Organization","name":"Tet"}</script>';
 assert.equal(parseMerchantPage(html,'https://www.tet.lv/veikals/viedtalruni/galaxy-s25.html',getCollectorStore('tet')!),null);
});
