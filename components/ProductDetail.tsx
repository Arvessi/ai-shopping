'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import PriceChart from './PriceChart';

type Product=any;
type Verdict={verdict:'Pērc tagad'|'Pagaidi'|'Salīdzini vēl';summary:string;reasons:string[];confidence:'zema'|'vidēja'|'augsta'};
const AXIS_LABELS:Record<string,string>={storage:'Atmiņa',ram:'RAM',color:'Krāsa',connectivity:'Savienojums',size:'Izmērs',cpu:'Procesors',gpu:'Grafika',resolution:'Izšķirtspēja',panelType:'Panelis',refreshRate:'Frekvence',kit:'Komplekts',condition:'Stāvoklis'};
const AXIS_ORDER=['storage','ram','color','connectivity','size','cpu','gpu','resolution','panelType','refreshRate','kit','condition'];

function money(value:number,currency='EUR'){try{return new Intl.NumberFormat('lv-LV',{style:'currency',currency}).format(value)}catch{return `${value.toFixed(2)} ${currency}`}}
function merchantKey(offer:any){return String(offer.merchantDomain||offer.merchant||'unknown').toLowerCase().replace(/^www\./,'')}
function matchVariant(offer:any,selected:Record<string,string>){const data=offer.variantData||{};return Object.entries(selected).every(([key,value])=>!value||data[key]===value)}
function specRows(attributes:Record<string,string>|undefined){if(!attributes)return[];return AXIS_ORDER.map(axis=>({axis,label:AXIS_LABELS[axis]||axis,value:attributes[axis]})).filter(item=>Boolean(item.value)&&!(item.axis==='condition'&&item.value==='New')).slice(0,8)}

export default function ProductDetail({id,variantId}:{id:string;variantId?:string}){
  const [product,setProduct]=useState<Product|null>(null);const [error,setError]=useState('');const [refreshing,setRefreshing]=useState(false);const [enriching,setEnriching]=useState(false);const [saved,setSaved]=useState(false);const [target,setTarget]=useState('');const [alertMsg,setAlertMsg]=useState('');const [showAll,setShowAll]=useState(false);const [selected,setSelected]=useState<Record<string,string>>({});const [verdict,setVerdict]=useState<Verdict|null>(null);const [verdictProvider,setVerdictProvider]=useState('');const [verdictLoading,setVerdictLoading]=useState(false);const [verdictError,setVerdictError]=useState('');const autoEnrichStarted=useRef(false);

  async function load(requestedVariantId=variantId){
    const response=await fetch(`/api/products/${encodeURIComponent(id)}${requestedVariantId?`?variantId=${encodeURIComponent(requestedVariantId)}`:''}`,{cache:'no-store'});const data=await response.json();
    if(!response.ok){setError(data.error||'Produkts nav atrasts.');return null}setError('');setProduct(data.product);if(!target&&data.product.currentBestPrice)setTarget((data.product.currentBestPrice*.95).toFixed(2));return data.product;
  }
  useEffect(()=>{void load()},[id,variantId]);
  const allOffers=useMemo(()=>product?.offers||[],[product]);
  const catalogVariants=useMemo(()=>product?.catalogVariants||[],[product?.catalogVariants]);
  const variantOptions=useMemo(()=>{const map=new Map<string,Set<string>>();const sources=catalogVariants.length?catalogVariants.map((variant:any)=>({variantData:variant.attributes})):allOffers;for(const source of sources){for(const [key,value] of Object.entries(source.variantData||{})){if(!value||(key==='condition'&&value==='New'))continue;if(!map.has(key))map.set(key,new Set());map.get(key)!.add(String(value))}}return Object.fromEntries(Array.from(map.entries()).map(([key,values])=>[key,Array.from(values)])) as Record<string,string[]>},[allOffers,catalogVariants]);
  useEffect(()=>{if(Object.keys(selected).length||!allOffers.length)return;const preferred=catalogVariants.find((variant:any)=>variant.id===product?.selectedVariantId);if(preferred){setSelected(preferred.attributes||{});return}const cheapest=[...allOffers].sort((a:any,b:any)=>a.totalPrice-b.totalPrice)[0];setSelected(cheapest?.variantData||{})},[allOffers,catalogVariants,product,selected]);
  const selectedVariant=useMemo(()=>catalogVariants.find((variant:any)=>Object.entries(selected).every(([key,value])=>!value||variant.attributes?.[key]===value)),[catalogVariants,selected]);
  function chooseVariantAxis(axis:string,option:string){const requested={...selected,[axis]:option};const exact=catalogVariants.find((variant:any)=>Object.entries(requested).every(([key,value])=>!value||variant.attributes?.[key]===value));if(!exact&&catalogVariants.length)return;setSelected(exact?.attributes||requested);setShowAll(false);if(exact){window.history.replaceState(window.history.state,'',`/product/${encodeURIComponent(id)}?variantId=${encodeURIComponent(exact.id)}`);void load(exact.id)}}
  const filteredOffers=useMemo(()=>{const attrs=selectedVariant?.attributes||selected;return allOffers.filter((offer:any)=>matchVariant(offer,attrs)).sort((a:any,b:any)=>a.totalPrice-b.totalPrice)},[allOffers,selected,selectedVariant]);
  const storeCount=useMemo(()=>new Set(filteredOffers.map((offer:any)=>merchantKey(offer))).size,[filteredOffers]);
  const totalStoreCount=useMemo(()=>new Set(allOffers.map((offer:any)=>merchantKey(offer))).size,[allOffers]);
  const best=filteredOffers[0];const bestScore=storeCount>=2?Math.max(0,...filteredOffers.map((offer:any)=>Number(offer.dealScore||0))):0;const visibleOffers=showAll?filteredOffers:filteredOffers.slice(0,6);const selectedImage=selectedVariant?.image||filteredOffers.find((offer:any)=>Boolean(offer.image))?.image||product?.familyImage||product?.image||'';const specs=specRows(selectedVariant?.attributes||selected);

  async function runRefresh(force=false,silent=false){if(refreshing||enriching)return;silent?setEnriching(true):setRefreshing(true);if(!silent)setError('');try{const start=await fetch(`/api/products/${encodeURIComponent(id)}/refresh?force=${force?'1':'0'}`,{method:'POST'});const startData=await start.json();if(!start.ok)throw new Error(startData.error||'Neizdevās atrast vairāk piedāvājumu.');if(!startData.pending){await load(selectedVariant?.id);return}let stage=startData.stage||'sellers';let taskId=startData.taskId;let retryAfterMs=750;for(let attempt=0;attempt<12;attempt+=1){await new Promise(resolve=>setTimeout(resolve,retryAfterMs));const poll=await fetch(`/api/products/${encodeURIComponent(id)}/refresh?stage=${encodeURIComponent(stage)}&taskId=${encodeURIComponent(taskId)}`);const pollData=await poll.json();if(!poll.ok)throw new Error(pollData.error||'Piedāvājumu atjaunošana neizdevās.');if(pollData.pending){retryAfterMs=Math.min(8000,Math.max(500,Number(pollData.retryAfterMs||retryAfterMs*1.7)));stage=pollData.stage||stage;taskId=pollData.taskId||taskId;continue}await load(selectedVariant?.id);setVerdict(null);return}throw new Error('Veikalu meklēšana aizņēma pārāk ilgu laiku.')}catch(e){if(!silent)setError(e instanceof Error?e.message:'Neizdevās atjaunot.')}finally{setRefreshing(false);setEnriching(false)}}
  useEffect(()=>{if(!product||autoEnrichStarted.current)return;const last=product.lastEnrichedAt?new Date(product.lastEnrichedAt).getTime():0;const stale=!last||Date.now()-last>12*60*60*1000;if(stale&&(totalStoreCount<2||!product.image)){autoEnrichStarted.current=true;const timer=window.setTimeout(()=>void runRefresh(false,true),500);return()=>window.clearTimeout(timer)}},[product,totalStoreCount]);
  async function wishlist(){const response=await fetch('/api/wishlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({familyId:product.id,variantId:selectedVariant?.id})});if(response.status===401){window.location.href='/login';return}if(response.ok)setSaved(true)}
  async function createAlert(){setAlertMsg('');const response=await fetch('/api/alerts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({familyId:product.id,variantId:selectedVariant?.id,targetPrice:Number(target),emailEnabled:true,browserEnabled:true})});const data=await response.json();if(response.status===401){window.location.href='/login';return}setAlertMsg(response.ok?'Brīdinājums izveidots ✓':data.error||'Neizdevās izveidot brīdinājumu.')}
  async function getVerdict(){if(verdictLoading)return;setVerdictLoading(true);setVerdictError('');try{const response=await fetch(`/api/products/${encodeURIComponent(id)}/verdict${selectedVariant?.id?`?variantId=${encodeURIComponent(selectedVariant.id)}`:''}`,{method:'POST'});const data=await response.json();if(!response.ok)throw new Error(data.error||'CENIQ analīze neizdevās.');setVerdict(data.verdict);setVerdictProvider(data.provider||'')}catch(e){setVerdictError(e instanceof Error?e.message:'CENIQ analīze neizdevās.')}finally{setVerdictLoading(false)}}

  if(error&&!product)return <div className="container intel-standalone"><div className="errorbox">{error}</div></div>;
  if(!product)return <div className="container intel-standalone"><div className="loaderline">Ielādē produktu…</div></div>;

  return <div className="container intel-page">
    <a className="intel-back" href="/">← Atpakaļ uz meklēšanu</a>
    <section className="intel-grid">
      <aside className="intel-visual">{selectedImage?<img src={selectedImage} alt={product.title}/>:<div className="intel-image-fallback">C</div>}<div className="intel-visual-meta"><span>{product.brand||'CENIQ'}</span><small>{totalStoreCount} {totalStoreCount===1?'veikals':'veikali'} katalogā</small></div></aside>
      <main className="intel-main">
        <div className="intel-kicker">PRODUKTA INTELLIGENCE</div><h1>{product.title}</h1>
        {specs.length>0&&<div className="intel-specs">{specs.map(spec=><div key={spec.axis}><span>{spec.label}</span><b>{spec.value}</b></div>)}</div>}
        {Object.keys(variantOptions).length>0&&<div className="intel-variants">{AXIS_ORDER.map(axis=>{const options=variantOptions[axis]||[];if(options.length<=1)return null;return <div className="intel-axis" key={axis}><span>{AXIS_LABELS[axis]}</span><div>{options.map(option=><button key={option} className={selected[axis]===option?'active':''} disabled={Boolean(catalogVariants.length)&&!catalogVariants.some((variant:any)=>variant.attributes?.[axis]===option&&Object.entries(selected).every(([key,value])=>key===axis||!value||variant.attributes?.[key]===value))} onClick={()=>chooseVariantAxis(axis,option)}>{option}</button>)}</div></div>})}</div>}
        <div className="intel-verdict"><div><span>CENIQ VERDICT</span><h3>{verdict?verdict.verdict:'Vai šī cena ir laba?'}</h3></div>{verdict?<><p>{verdict.summary}</p><ul>{verdict.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul><small>{verdictProvider==='gemini'?'AI: Gemini':'CENIQ noteikumu analīze'} · {verdict.confidence} pārliecība</small></>:<button onClick={getVerdict} disabled={verdictLoading}>{verdictLoading?'Analizē…':'Analizēt cenu →'}</button>}{verdictError&&<small className="verdictError">{verdictError}</small>}</div>
      </main>
      <aside className="buy-dock">
        <span>LABĀKĀ CENA ŠOBRĪD</span><strong>{best?money(best.totalPrice,best.currency):'—'}</strong><small>{best?.merchant||'Piedāvājumu nav'}</small>
        <div className="buy-dock-metrics"><div><span>Veikali</span><b>{storeCount||'—'}</b></div><div><span>CENIQ</span><b>{bestScore>0?`${bestScore}/100`:'—'}</b></div></div>
        <div className="buy-dock-list">{filteredOffers.slice(0,3).map((offer:any,index:number)=><a href={`/api/out?offerId=${encodeURIComponent(offer.id)}`} target="_blank" rel="nofollow sponsored noopener" key={offer.id||`${merchantKey(offer)}-${index}`}><span>{index===0&&storeCount>=2?'★':String(index+1).padStart(2,'0')}</span><b>{offer.merchant}</b><strong>{money(offer.totalPrice,offer.currency)}</strong></a>)}</div>
        <button className="buy-primary" onClick={()=>best&&window.open(`/api/out?offerId=${encodeURIComponent(best.id)}`,'_blank','noopener,noreferrer')} disabled={!best}>Uz labāko veikalu ↗</button>
        <div className="buy-actions"><button onClick={wishlist}>{saved?'♥ Saglabāts':'♡ Saglabāt'}</button><button onClick={()=>runRefresh(true,false)} disabled={refreshing}>{refreshing?'Meklē…':totalStoreCount<3?'⌕ Vairāk veikalu':'↻ Atjaunot'}</button></div>
        {enriching&&<div className="intel-enrich"><i/>Meklē vēl veikalus…</div>}
      </aside>
    </section>
    {error&&<div className="errorbox">{error}</div>}

    <section className="merchant-board">
      <header><div><span>VEIKALU TIRGUS</span><h2>{storeCount?`${storeCount} ${storeCount===1?'veikals':'veikali'} šim variantam`:'Piedāvājumi nav atrasti'}</h2></div><small>{filteredOffers.length} piedāvājumi</small></header>
      <div className="merchant-table">{visibleOffers.length?visibleOffers.map((offer:any,index:number)=><div className={`merchant-line ${index===0&&storeCount>=2?'is-best':''}`} key={offer.id||`${merchantKey(offer)}-${index}`}><span className="merchant-rank">{index===0&&storeCount>=2?'★':String(index+1).padStart(2,'0')}</span><div><b>{offer.merchant}</b><small>{offer.deliveryMessage||'Pieejamību pārbaudīt veikalā'}</small></div><div className="merchant-score">{storeCount>=2&&offer.dealScore>0?<><b>{offer.dealScore}</b><span>/100</span></>:'—'}</div><strong>{money(offer.totalPrice,offer.currency)}</strong><a href={`/api/out?offerId=${encodeURIComponent(offer.id)}`} target="_blank" rel="nofollow sponsored noopener">Uz veikalu ↗</a></div>):<div className="market-empty">Šai variantu kombinācijai piedāvājums nav atrasts.</div>}</div>
      {filteredOffers.length>6&&<button className="market-more" onClick={()=>setShowAll(value=>!value)}>{showAll?'Rādīt mazāk':`Rādīt visus ${filteredOffers.length}`}</button>}
    </section>

    <section className="intel-lower"><div className="intel-chart"><header><span>CENAS VĒSTURE</span><h2>Cenas dinamika</h2></header><PriceChart points={product.snapshots} currency={product.currency}/></div><aside className="intel-alert"><span>CENU BRĪDINĀJUMS</span><h2>Pasaki savu cenu.</h2><p>CENIQ paziņos, kad cena nokritīs līdz tavam mērķim.</p><label>Mērķa cena (€)<input type="number" min="1" step="0.01" value={target} onChange={(e:ChangeEvent<HTMLInputElement>)=>setTarget(e.target.value)}/></label><button onClick={createAlert}>Izveidot brīdinājumu</button>{alertMsg&&<small>{alertMsg}</small>}</aside></section>
  </div>;
}
