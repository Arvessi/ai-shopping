'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import ProductCard from './ProductCard';
import type { AiShoppingPlan, ProductResult } from '@/lib/types';

const categories = [
  { label:'Telefoni', detail:'Viedtālruņi un ierīces', query:'smartphone' },
  { label:'Datori', detail:'Portatīvie un darba stacijas', query:'laptop' },
  { label:'Monitori', detail:'Darba un spēļu monitori', query:'monitor' },
  { label:'TV', detail:'OLED, QLED un 4K', query:'TV' },
  { label:'Audio', detail:'Austiņas un skaņa', query:'headphones' },
  { label:'Gaming', detail:'Datori un spēļu tehnika', query:'gaming' },
  { label:'Kameras', detail:'Foto un video', query:'camera' },
  { label:'Sadzīves tehnika', detail:'Tehnika mājai', query:'home appliance' },
  { label:'Sports', detail:'Treniņiem un brīvā dabā', query:'sports' },
  { label:'Velo', detail:'Velosipēdi un aprīkojums', query:'bike' },
  { label:'Skaistums', detail:'Kosmētika un kopšana', query:'beauty' },
  { label:'Bērniem', detail:'Rotaļlietas un preces', query:'toys' },
];
const fallbackPopular=['iPhone 16','Samsung Galaxy S25','Lenovo Legion 5','Sony WH-1000XM5','LG OLED C4'];
const SEARCH_STATE_KEY='ceniq-search-state-v4';

type SearchMode='search'|'assistant';
type SortMode='coverage'|'price'|'score';
type SavedSearchState={query:string;mode:SearchMode;results:ProductResult[];notice:string;plan:AiShoppingPlan|null;source?:string};

function merchantKey(value:{merchantDomain?:string;merchant?:string}) { return String(value.merchantDomain||value.merchant||'').toLowerCase().replace(/^www\./,''); }
function groupCoverage(product:ProductResult) { return product.storesCount||new Set((product.offers||[]).map(merchantKey).filter(Boolean)).size; }
function groupBestPrice(product:ProductResult) {
  if(Number.isFinite(product.bestPrice)&&product.bestPrice>0) return product.bestPrice;
  const prices=(product.offers||[]).map(offer=>Number(offer.totalPrice)).filter(price=>Number.isFinite(price)&&price>0);
  return prices.length?Math.min(...prices):Number.MAX_SAFE_INTEGER;
}
function groupBestScore(product:ProductResult) { return Math.max(Number(product.dealScore||0),...(product.offers||[]).map(offer=>Number(offer.dealScore||0))); }
function groupVariantCount(product:ProductResult) { return (product.catalogVariants||[]).filter(variant=>variant.offerCount>0).length; }

export default function SearchExperience() {
  const [mode,setMode]=useState<SearchMode>('search');
  const [query,setQuery]=useState('');
  const [results,setResults]=useState<ProductResult[]>([]);
  const [popular,setPopular]=useState<string[]>(fallbackPopular);
  const [loading,setLoading]=useState(false);
  const [status,setStatus]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [plan,setPlan]=useState<AiShoppingPlan|null>(null);
  const [source,setSource]=useState('');
  const [restored,setRestored]=useState(false);
  const [sortMode,setSortMode]=useState<SortMode>('coverage');
  const [brandFilter,setBrandFilter]=useState('all');
  const [minStores,setMinStores]=useState(0);
  const [maxPrice,setMaxPrice]=useState('');
  const searchVersion=useRef(0);

  useEffect(()=>{
    fetch('/api/popular').then(response=>response.json()).then(data=>{ if(data.searches?.length) setPopular(data.searches); }).catch(()=>undefined);
    try {
      const saved=window.sessionStorage.getItem(SEARCH_STATE_KEY);
      if(saved) {
        const parsed=JSON.parse(saved) as Partial<SavedSearchState>;
        if(typeof parsed.query==='string') setQuery(parsed.query);
        if(parsed.mode==='assistant'||parsed.mode==='search') setMode(parsed.mode);
        if(Array.isArray(parsed.results)) setResults(parsed.results);
        if(typeof parsed.notice==='string') setNotice(parsed.notice);
        if(typeof parsed.source==='string') setSource(parsed.source);
        if(parsed.plan) { setPlan(parsed.plan); if(parsed.plan.maxPrice) setMaxPrice(String(parsed.plan.maxPrice)); }
      } else {
        const params=new URLSearchParams(window.location.search);
        const q=params.get('q'); const m=params.get('mode');
        if(q) setQuery(q); if(m==='assistant') setMode('assistant');
      }
    } catch { window.sessionStorage.removeItem(SEARCH_STATE_KEY); }
    finally { setRestored(true); }
  },[]);

  useEffect(()=>{
    if(!restored) return;
    const state:SavedSearchState={query,mode,results,notice,plan,source};
    try { window.sessionStorage.setItem(SEARCH_STATE_KEY,JSON.stringify(state)); } catch {}
  },[restored,query,mode,results,notice,plan,source]);

  const brands=useMemo(()=>Array.from(new Set(results.map(product=>product.brand?.trim()).filter((brand):brand is string=>Boolean(brand)))).sort((a,b)=>a.localeCompare(b)),[results]);
  const visibleResults=useMemo(()=>{
    const ceiling=maxPrice?Number(maxPrice.replace(',','.')):0;
    const filtered=results.filter(product=>{
      if(brandFilter!=='all'&&product.brand!==brandFilter) return false;
      if(minStores>0&&groupCoverage(product)<minStores) return false;
      if(Number.isFinite(ceiling)&&ceiling>0&&groupBestPrice(product)>ceiling) return false;
      return true;
    });
    return [...filtered].sort((a,b)=>{
      if(sortMode==='price') return groupBestPrice(a)-groupBestPrice(b)||groupCoverage(b)-groupCoverage(a);
      if(sortMode==='score') return groupBestScore(b)-groupBestScore(a)||groupCoverage(b)-groupCoverage(a)||groupBestPrice(a)-groupBestPrice(b);
      return groupCoverage(b)-groupCoverage(a)||groupVariantCount(b)-groupVariantCount(a)||groupBestScore(b)-groupBestScore(a)||groupBestPrice(a)-groupBestPrice(b);
    });
  },[results,sortMode,brandFilter,minStores,maxPrice]);

  function updateUrl(searchQuery:string,searchMode:SearchMode) {
    const url=new URL(window.location.href); url.searchParams.set('q',searchQuery); url.searchParams.set('mode',searchMode);
    window.history.replaceState(window.history.state,'',`${url.pathname}${url.search}${url.hash}`);
  }
  function resetFilters(){ setBrandFilter('all'); setMinStores(0); setMaxPrice(''); }

  async function runSearch(searchQuery:string,searchMode:SearchMode) {
    const version=++searchVersion.current; setStatus('Pārbauda CENIQ katalogu…');
    const controller=new AbortController(); const timeout=window.setTimeout(()=>controller.abort(),10_000);
    try {
      const response=await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:searchQuery,mode:searchMode}),cache:'no-store',signal:controller.signal});
      const data=await response.json(); if(searchVersion.current!==version) return; if(!response.ok) throw new Error(data.error||'Meklēšana neizdevās.');
      const nextResults=Array.isArray(data.results)?data.results:[];
      setResults(nextResults); setSource(data.source||''); setSortMode('coverage'); setNotice(nextResults.length?'':data.message||'Nekas netika atrasts.'); setStatus('');
      if(nextResults.length) window.setTimeout(()=>document.getElementById('results')?.scrollIntoView({behavior:'smooth',block:'start'}),60);
    } finally { window.clearTimeout(timeout); }
  }

  async function submit(e?:FormEvent,override?:string,forcedMode?:SearchMode) {
    e?.preventDefault(); const activeMode=forcedMode??mode; const input=(override??query).trim(); if(!input||loading) return;
    setQuery(input); setMode(activeMode); updateUrl(input,activeMode); setLoading(true); setError(''); setNotice(''); setResults([]); setPlan(null); setSource(''); resetFilters();
    try {
      if(activeMode==='assistant') {
        setStatus('CENIQ AI saprot tavas prasības…');
        const controller=new AbortController(); const timeout=window.setTimeout(()=>controller.abort(),10_000);
        try {
          const response=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:input}),cache:'no-store',signal:controller.signal});
          const data=await response.json(); if(!response.ok) throw new Error(data.error||'CENIQ AI neizdevās.');
          const nextPlan=data.plan as AiShoppingPlan; setPlan(nextPlan); if(nextPlan.maxPrice) setMaxPrice(String(nextPlan.maxPrice)); await runSearch(nextPlan.searchQuery,'assistant');
        } finally { window.clearTimeout(timeout); }
      } else await runSearch(input,'search');
    } catch(err) {
      setError(err instanceof Error?(err.name==='AbortError'?'Meklēšana aizņēma pārāk ilgu laiku. Pamēģini vēlreiz.':err.message):'Radās kļūda.'); setStatus('');
    } finally { setLoading(false); }
  }

  const sourceLabel=source==='canonical-catalog'?'CENIQ katalogs · aktuālie piedāvājumi':'';
  const filtersActive=brandFilter!=='all'||minStores>0||Boolean(maxPrice);

  return <>
    <section className={`scan-hero ${results.length?'is-compact':''}`} id="meklet">
      <div className="container scan-shell">
        <div className="scan-brandline"><span>CENIQ / PRICE INTELLIGENCE</span><b>Latvija · aktuāls katalogs</b></div>
        {!results.length&&<div className="scan-intro"><h1>Nevis vēl viens veikals.<br/><em>Viens skats uz tirgu.</em></h1><p>Meklē produktu un redzi variantus, cenas un veikalus vienā cenu kartē.</p></div>}
        <form className="scan-console" onSubmit={(event:FormEvent<HTMLFormElement>)=>submit(event)}>
          <div className="scan-modes" role="tablist" aria-label="Meklēšanas režīms">
            <button type="button" className={mode==='search'?'active':''} onClick={()=>setMode('search')}>Meklēt</button>
            <button type="button" className={mode==='assistant'?'active':''} onClick={()=>setMode('assistant')}>CENIQ AI</button>
          </div>
          <div className="scan-input"><span>⌕</span><input value={query} onChange={(event:ChangeEvent<HTMLInputElement>)=>setQuery(event.target.value)} aria-label={mode==='search'?'Meklējamais produkts':'Apraksti vajadzīgo produktu'} placeholder={mode==='search'?'Ko salīdzinām? Piem., Samsung Galaxy S25':'Apraksti, ko meklē un kāds ir budžets'}/><button disabled={loading}>{loading?'Meklē…':'Skenēt cenas →'}</button></div>
        </form>
        <div className="scan-foot"><span>0 ārējo API zvanu meklēšanas brīdī</span><span>Varianti netiek jaukti</span><span>Veikalu cenas vienā skatā</span></div>
        {status&&<div className="searchstatus"><i/>{status}</div>}{error&&<div className="errorbox">{error}</div>}{notice&&!error&&<div className="searchnotice">{notice}</div>}
      </div>
    </section>

    {plan&&<section className="container aianswer"><div className="aibadge">CENIQ AI PLĀNS</div><h2>{plan.summary}</h2>{!!plan.constraints?.length&&<div className="chips">{plan.constraints.map(constraint=><span key={constraint}>{constraint}</span>)}</div>}</section>}

    {results.length>0&&<section className="container market-board" id="results">
      <header className="market-board-head"><div><span>ATRastie PRODUKTI</span><h2>{query}</h2></div><div>{sourceLabel&&<small>{sourceLabel}</small>}<b>{visibleResults.length} / {results.length} produktu grupas</b></div></header>
      <div className="market-controls">
        <label><span>Zīmols</span><select value={brandFilter} onChange={event=>setBrandFilter(event.target.value)}><option value="all">Visi zīmoli</option>{brands.map(brand=><option value={brand} key={brand}>{brand}</option>)}</select></label>
        <label><span>Veikali</span><select value={minStores} onChange={event=>setMinStores(Number(event.target.value))}><option value={0}>Jebkurš skaits</option><option value={2}>2+</option><option value={3}>3+</option><option value={5}>5+</option></select></label>
        <label><span>Līdz</span><div className="market-price-filter"><input inputMode="decimal" type="number" min="1" step="1" placeholder="Bez limita" value={maxPrice} onChange={event=>setMaxPrice(event.target.value)}/><b>€</b></div></label>
        <div className="market-sort"><span>Kārtot</span><button type="button" className={sortMode==='coverage'?'active':''} onClick={()=>setSortMode('coverage')}>Veikalu skaits</button><button type="button" className={sortMode==='price'?'active':''} onClick={()=>setSortMode('price')}>Cena</button><button type="button" className={sortMode==='score'?'active':''} onClick={()=>setSortMode('score')}>Score</button></div>
        {filtersActive&&<button className="market-reset" type="button" onClick={resetFilters}>Notīrīt</button>}
      </div>
      {visibleResults.length?<div className="market-list">{visibleResults.map(product=><ProductCard product={product} query={query} key={`${product.id}:${product.title}`}/>)}</div>:<div className="filterempty filterempty-large"><b>Šiem filtriem nav rezultātu.</b><button type="button" onClick={resetFilters}>Notīrīt filtrus</button></div>}
    </section>}

    {!results.length&&<>
      <section className="container discovery-strip" id="populari"><div className="discovery-label"><span>TAGAD MEKLĒ</span><h2>Populārie</h2></div><div className="discovery-items">{popular.slice(0,5).map((item,index)=><button type="button" key={item} onClick={()=>submit(undefined,item,'search')}><small>{String(index+1).padStart(2,'0')}</small><b>{item}</b><span>→</span></button>)}</div></section>
      <section className="container category-index" id="kategorijas"><div className="category-index-head"><span>KATALOGS</span><h2>Ko salīdzinām?</h2></div><div className="category-index-grid">{categories.map((category,index)=><button type="button" key={category.label} onClick={()=>submit(undefined,category.query,'search')}><small>{String(index+1).padStart(2,'0')}</small><div><b>{category.label}</b><span>{category.detail}</span></div><i>↗</i></button>)}</div></section>
      <section className="container c10-how" id="ka-darbojas"><div><span>KĀ TAS STRĀDĀ</span><h2>Produkts → variants → tirgus.</h2></div><ol><li><b>01</b><span>Veikalu dati tiek savākti iepriekš.</span></li><li><b>02</b><span>CENIQ saliek vienādos variantus kopā.</span></li><li><b>03</b><span>Tu redzi cenu tirgu, nevis vienu reklāmu.</span></li></ol></section>
    </>}
  </>;
}
