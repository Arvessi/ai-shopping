'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import PriceChart from './PriceChart';

type Product = any;
type Verdict = {
  verdict: 'Pērc tagad' | 'Pagaidi' | 'Salīdzini vēl';
  summary: string;
  reasons: string[];
  confidence: 'zema' | 'vidēja' | 'augsta';
};

const AXIS_LABELS: Record<string,string> = {
  storage:'Atmiņa', ram:'RAM', color:'Krāsa', connectivity:'Savienojums', size:'Izmērs',
  cpu:'Procesors', gpu:'Grafika', resolution:'Izšķirtspēja', panelType:'Panelis',
  refreshRate:'Frekvence', kit:'Komplekts', condition:'Stāvoklis',
};
const AXIS_ORDER = ['storage','ram','color','connectivity','size','cpu','gpu','resolution','panelType','refreshRate','kit','condition'];

function money(value:number,currency='EUR') {
  try { return new Intl.NumberFormat('lv-LV',{style:'currency',currency}).format(value); }
  catch { return `${value.toFixed(2)} ${currency}`; }
}
function merchantKey(offer:any) {
  return String(offer.merchantDomain||offer.merchant||'unknown').toLowerCase().replace(/^www\./,'');
}
function matchVariant(offer:any,selected:Record<string,string>) {
  const data=offer.variantData||{};
  return Object.entries(selected).every(([key,value])=>!value||data[key]===value);
}
function specRows(attributes:Record<string,string>|undefined) {
  if(!attributes) return [];
  return AXIS_ORDER
    .map(axis=>({axis,label:AXIS_LABELS[axis]||axis,value:attributes[axis]}))
    .filter(item=>Boolean(item.value)&&!(item.axis==='condition'&&item.value==='New'))
    .slice(0,8);
}

export default function ProductDetail({id,variantId}:{id:string;variantId?:string}) {
  const [product,setProduct]=useState<Product|null>(null);
  const [error,setError]=useState('');
  const [refreshing,setRefreshing]=useState(false);
  const [enriching,setEnriching]=useState(false);
  const [saved,setSaved]=useState(false);
  const [target,setTarget]=useState('');
  const [alertMsg,setAlertMsg]=useState('');
  const [showAll,setShowAll]=useState(false);
  const [selected,setSelected]=useState<Record<string,string>>({});
  const [verdict,setVerdict]=useState<Verdict|null>(null);
  const [verdictProvider,setVerdictProvider]=useState('');
  const [verdictLoading,setVerdictLoading]=useState(false);
  const [verdictError,setVerdictError]=useState('');
  const autoEnrichStarted=useRef(false);

  async function load(requestedVariantId=variantId) {
    const response=await fetch(`/api/products/${encodeURIComponent(id)}${requestedVariantId?`?variantId=${encodeURIComponent(requestedVariantId)}`:''}`,{cache:'no-store'});
    const data=await response.json();
    if(!response.ok) {
      setError(data.error||'Produkts nav atrasts.');
      return null;
    }
    setError('');
    setProduct(data.product);
    if(!target&&data.product.currentBestPrice) setTarget((data.product.currentBestPrice*0.95).toFixed(2));
    return data.product;
  }

  useEffect(()=>{ void load(); },[id,variantId]);

  const allOffers=useMemo(()=>product?.offers||[],[product]);
  const catalogVariants=useMemo(()=>product?.catalogVariants||[],[product?.catalogVariants]);

  const variantOptions=useMemo(()=>{
    const map=new Map<string,Set<string>>();
    const sources=catalogVariants.length?catalogVariants.map((variant:any)=>({variantData:variant.attributes})):allOffers;
    for(const source of sources) {
      for(const [key,value] of Object.entries(source.variantData||{})) {
        if(!value||(key==='condition'&&value==='New')) continue;
        if(!map.has(key)) map.set(key,new Set());
        map.get(key)!.add(String(value));
      }
    }
    return Object.fromEntries(Array.from(map.entries()).map(([key,values])=>[key,Array.from(values)])) as Record<string,string[]>;
  },[allOffers,catalogVariants]);

  useEffect(()=>{
    if(Object.keys(selected).length||!allOffers.length) return;
    const preferred=catalogVariants.find((variant:any)=>variant.id===product?.selectedVariantId);
    if(preferred) { setSelected(preferred.attributes||{}); return; }
    const cheapest=[...allOffers].sort((a:any,b:any)=>a.totalPrice-b.totalPrice)[0];
    setSelected(cheapest?.variantData||{});
  },[allOffers,catalogVariants,product,selected]);

  const selectedVariant=useMemo(()=>catalogVariants.find((variant:any)=>Object.entries(selected).every(([key,value])=>!value||variant.attributes?.[key]===value)),[catalogVariants,selected]);

  function chooseVariantAxis(axis:string,option:string) {
    const requested={...selected,[axis]:option};
    const exact=catalogVariants.find((variant:any)=>Object.entries(requested).every(([key,value])=>!value||variant.attributes?.[key]===value));
    if(!exact&&catalogVariants.length) return;
    setSelected(exact?.attributes||requested);
    setShowAll(false);
    if(exact) {
      window.history.replaceState(window.history.state,'',`/product/${encodeURIComponent(id)}?variantId=${encodeURIComponent(exact.id)}`);
      void load(exact.id);
    }
  }

  const filteredOffers=useMemo(()=>{
    const attrs=selectedVariant?.attributes||selected;
    return allOffers
      .filter((offer:any)=>matchVariant(offer,attrs))
      .sort((a:any,b:any)=>{
        if(a.isBestOverall!==b.isBestOverall) return a.isBestOverall?-1:1;
        if(a.isCheapest!==b.isCheapest) return a.isCheapest?-1:1;
        return a.totalPrice-b.totalPrice;
      });
  },[allOffers,selected,selectedVariant]);

  const storeCount=useMemo(()=>new Set(filteredOffers.map((offer:any)=>merchantKey(offer))).size,[filteredOffers]);
  const totalStoreCount=useMemo(()=>new Set(allOffers.map((offer:any)=>merchantKey(offer))).size,[allOffers]);
  const best=filteredOffers.find((offer:any)=>offer.isBestOverall)||filteredOffers.find((offer:any)=>offer.isCheapest)||filteredOffers[0];
  const bestScore=storeCount>=2?Math.max(0,...filteredOffers.map((offer:any)=>Number(offer.dealScore||0))):0;
  const visibleOffers=showAll?filteredOffers:filteredOffers.slice(0,5);
  const selectedImage=selectedVariant?.image||filteredOffers.find((offer:any)=>Boolean(offer.image))?.image||product?.familyImage||product?.image||'';
  const specs=specRows(selectedVariant?.attributes||selected);

  async function runRefresh(force=false,silent=false) {
    if(refreshing||enriching) return;
    silent?setEnriching(true):setRefreshing(true);
    if(!silent) setError('');
    try {
      const start=await fetch(`/api/products/${encodeURIComponent(id)}/refresh?force=${force?'1':'0'}`,{method:'POST'});
      const startData=await start.json();
      if(!start.ok) throw new Error(startData.error||'Neizdevās atrast vairāk piedāvājumu.');
      if(!startData.pending) { await load(selectedVariant?.id); return; }

      let stage=startData.stage||'sellers';
      let taskId=startData.taskId;
      let retryAfterMs=750;
      for(let attempt=0;attempt<12;attempt+=1) {
        await new Promise(resolve=>setTimeout(resolve,retryAfterMs));
        const poll=await fetch(`/api/products/${encodeURIComponent(id)}/refresh?stage=${encodeURIComponent(stage)}&taskId=${encodeURIComponent(taskId)}`);
        const pollData=await poll.json();
        if(!poll.ok) throw new Error(pollData.error||'Piedāvājumu atjaunošana neizdevās.');
        if(pollData.pending) {
          retryAfterMs=Math.min(8000,Math.max(500,Number(pollData.retryAfterMs||retryAfterMs*1.7)));
          stage=pollData.stage||stage;
          taskId=pollData.taskId||taskId;
          continue;
        }
        await load(selectedVariant?.id);
        setVerdict(null);
        return;
      }
      throw new Error('Veikalu meklēšana aizņēma pārāk ilgu laiku.');
    } catch(e) {
      if(!silent) setError(e instanceof Error?e.message:'Neizdevās atjaunot.');
    } finally {
      setRefreshing(false);
      setEnriching(false);
    }
  }

  useEffect(()=>{
    if(!product||autoEnrichStarted.current) return;
    const last=product.lastEnrichedAt?new Date(product.lastEnrichedAt).getTime():0;
    const stale=!last||Date.now()-last>12*60*60*1000;
    if(stale&&(totalStoreCount<2||!product.image)) {
      autoEnrichStarted.current=true;
      const timer=window.setTimeout(()=>void runRefresh(false,true),500);
      return ()=>window.clearTimeout(timer);
    }
  },[product,totalStoreCount]);

  async function wishlist() {
    const response=await fetch('/api/wishlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({familyId:product.id,variantId:selectedVariant?.id})});
    if(response.status===401) { window.location.href='/login'; return; }
    if(response.ok) setSaved(true);
  }

  async function createAlert() {
    setAlertMsg('');
    const response=await fetch('/api/alerts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({familyId:product.id,variantId:selectedVariant?.id,targetPrice:Number(target),emailEnabled:true,browserEnabled:true})});
    const data=await response.json();
    if(response.status===401) { window.location.href='/login'; return; }
    setAlertMsg(response.ok?'Brīdinājums izveidots ✓':data.error||'Neizdevās izveidot brīdinājumu.');
  }

  async function getVerdict() {
    if(verdictLoading) return;
    setVerdictLoading(true); setVerdictError('');
    try {
      const response=await fetch(`/api/products/${encodeURIComponent(id)}/verdict${selectedVariant?.id?`?variantId=${encodeURIComponent(selectedVariant.id)}`:''}`,{method:'POST'});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||'CENIQ analīze neizdevās.');
      setVerdict(data.verdict); setVerdictProvider(data.provider||'');
    } catch(e) {
      setVerdictError(e instanceof Error?e.message:'CENIQ analīze neizdevās.');
    } finally { setVerdictLoading(false); }
  }

  if(error&&!product) return <div className="container standalone"><div className="errorbox">{error}</div></div>;
  if(!product) return <div className="container standalone"><div className="loaderline">Ielādē produktu…</div></div>;

  return <div className="container productpage">
    <a className="backlink" href="/">← Atpakaļ uz meklēšanu</a>

    <section className="producthero">
      <div className="detailimage">
        {selectedImage?<img src={selectedImage} alt={product.title}/>:<div className="imagefallback imagefallback-soft"><span>C</span><small>Nav produkta attēla</small></div>}
      </div>

      <div className="detailcopy">
        <div className="eyebrow">{product.brand||'CENIQ produkts'}</div>
        <h1>{product.title}</h1>

        {Object.keys(variantOptions).length>0&&<div className="variantpicker">
          {AXIS_ORDER.map(axis=>{
            const options=variantOptions[axis]||[];
            if(options.length<=1) return null;
            return <div className="variantaxis" key={axis}>
              <span>{AXIS_LABELS[axis]}</span>
              <div className="variantbuttons">{options.map(option=><button key={option} className={selected[axis]===option?'active':''} disabled={Boolean(catalogVariants.length)&&!catalogVariants.some((variant:any)=>variant.attributes?.[axis]===option&&Object.entries(selected).every(([key,value])=>key===axis||!value||variant.attributes?.[key]===value))} onClick={()=>chooseVariantAxis(axis,option)}>{option}</button>)}</div>
            </div>;
          })}
        </div>}

        {specs.length>0&&<div className="specstrip">{specs.map(spec=><div key={spec.axis}><span>{spec.label}</span><b>{spec.value}</b></div>)}</div>}

        <div className="productfacts">
          <div><span>Labākā cena</span><strong>{best?money(best.totalPrice,best.currency):'—'}</strong></div>
          <div><span>Veikali</span><strong>{storeCount||'—'}</strong></div>
          <div><span>CENIQ score</span><strong>{bestScore>0?`${bestScore}/100`:'Vēl nav'}</strong></div>
        </div>

        {enriching&&<div className="enrichstatus"><i/>CENIQ fonā meklē vēl veikalus…</div>}

        <div className="detailactions">
          <button className="primary" onClick={wishlist}>{saved?'♥ Saglabāts':'♡ Saglabāt'}</button>
          <button className="secondary" onClick={()=>runRefresh(true,false)} disabled={refreshing}>{refreshing?'Meklē…':totalStoreCount<3?'⌕ Atrast vairāk veikalu':'↻ Atjaunot cenas'}</button>
        </div>

        <div className="aiverdict">
          <div className="aiverdicthead"><div><span>✦ CENIQ VERDICT</span><h3>{verdict?verdict.verdict:'Ko CENIQ domā par šo cenu?'}</h3></div>{verdict&&<small>{verdict.confidence} pārliecība</small>}</div>
          {verdict?<><p>{verdict.summary}</p><ul>{verdict.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul><small className="verdictprovider">{verdictProvider==='gemini'?'AI: Gemini':'CENIQ noteikumu analīze'}</small></>:<><p>Ātrs vērtējums par cenu, veikalu skaitu un piedāvājuma kvalitāti.</p><button className="primary" onClick={getVerdict} disabled={verdictLoading}>{verdictLoading?'Analizē…':'Saņemt CENIQ viedokli'}</button></>}
          {verdictError&&<small className="verdictError">{verdictError}</small>}
        </div>
      </div>
    </section>

    {error&&<div className="errorbox">{error}</div>}

    <section className="detailsection offersection-v21">
      <div className="sectiontitle"><div><span>VEIKALU PIEDĀVĀJUMI</span><h2>{storeCount>=3?'Labākie piedāvājumi':storeCount===2?'2 veikali šim variantam':storeCount===1?'1 veikals šim variantam':'Piedāvājumi nav atrasti'}</h2></div><p>{filteredOffers.length} {filteredOffers.length===1?'piedāvājums':'piedāvājumi'}</p></div>
      {visibleOffers.length?<div className="topoffergrid topoffergrid-v21">{visibleOffers.map((offer:any,index:number)=><article className={`topoffer ${index===0&&storeCount>=2?'topoffer-best':''}`} key={offer.id||`${merchantKey(offer)}-${index}`}>
        <div className="topofferindex">{String(index+1).padStart(2,'0')}</div>
        <div className="topoffermerchant"><span>{index===0&&storeCount>=2?'CENIQ IZVĒLE':'PIEDĀVĀJUMS'}</span><h3>{offer.merchant}</h3>{offer.variantLabel&&<small>{offer.variantLabel}</small>}</div>
        <div className="topofferprice"><span>Kopējā cena</span><strong>{money(offer.totalPrice,offer.currency)}</strong><small>{offer.deliveryMessage||'Pieejamību pārbaudīt veikalā'}</small></div>
        {offer.dealScore>0&&storeCount>=2&&<div className="offerscore"><b>{offer.dealScore}</b><span>/100</span></div>}
        <a className="offercta" href={`/api/out?offerId=${encodeURIComponent(offer.id)}`} target="_blank" rel="nofollow sponsored noopener">Uz veikalu ↗</a>
      </article>)}</div>:<div className="filterempty">Šai variantu kombinācijai piedāvājums nav atrasts.</div>}
      {filteredOffers.length>5&&<button className="showalloffers" onClick={()=>setShowAll(value=>!value)}>{showAll?'Rādīt mazāk':`Rādīt visus ${filteredOffers.length} piedāvājumus`}</button>}
    </section>

    <section className="twocol">
      <div className="detailsection"><div className="sectiontitle"><div><span>VĒSTURE</span><h2>Cenas dinamika</h2></div></div><PriceChart points={product.snapshots} currency={product.currency}/></div>
      <div className="detailsection alertbox"><span className="eyebrow">CENU BRĪDINĀJUMS</span><h2>Pasaki savu cenu.</h2><label>Mērķa cena (€)<input type="number" min="1" step="0.01" value={target} onChange={(e:ChangeEvent<HTMLInputElement>)=>setTarget(e.target.value)}/></label><button className="primary" onClick={createAlert}>🔔 Izveidot</button>{alertMsg&&<small>{alertMsg}</small>}</div>
    </section>
  </div>;
}
