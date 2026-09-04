'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { CatalogVariantView, OfferView, ProductResult, VariantAttributes } from '@/lib/types';

const AXIS_ORDER: Array<keyof VariantAttributes> = ['storage','color','ram','connectivity','size','cpu','gpu','resolution','panelType','refreshRate','kit','condition'];
const AXIS_LABELS: Partial<Record<keyof VariantAttributes, string>> = {
  storage:'Atmiņa', color:'Krāsa', ram:'RAM', connectivity:'Savienojums', size:'Izmērs', cpu:'Procesors', gpu:'Grafika', resolution:'Izšķirtspēja', panelType:'Panelis', refreshRate:'Frekvence', kit:'Komplekts', condition:'Stāvoklis',
};

function money(value:number,currency='EUR') {
  try { return new Intl.NumberFormat('lv-LV',{style:'currency',currency}).format(value); }
  catch { return `${value.toFixed(2)} ${currency}`; }
}
function merchantKey(offer:OfferView){ return String(offer.merchantDomain||offer.merchant||'').toLowerCase().replace(/^www\./,''); }
function sameSelection(attributes:VariantAttributes,selected:Partial<VariantAttributes>){ return Object.entries(selected).every(([key,value])=>!value||attributes[key as keyof VariantAttributes]===value); }
function variantOptions(variants:CatalogVariantView[]){
  const result:Partial<Record<keyof VariantAttributes,string[]>>={};
  for(const axis of AXIS_ORDER){
    const values=Array.from(new Set(variants.filter(v=>v.offerCount>0).map(v=>v.attributes?.[axis]).filter((value):value is string=>Boolean(value)&&!(axis==='condition'&&value==='New')))).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    if(values.length>1) result[axis]=values;
  }
  return result;
}
function queryChoice(query:string,values:string[]){ const normalized=query.toLowerCase().replace(/\s+/g,''); return values.find(value=>normalized.includes(value.toLowerCase().replace(/\s+/g,''))); }
function availability(offer:OfferView){ return offer.deliveryMessage||'Pārbaudīt veikalā'; }
function selectedScore(offers:OfferView[]){ if(new Set(offers.map(merchantKey)).size<2) return 0; return Math.max(0,...offers.map(offer=>Number(offer.dealScore||0))); }
function chooseBestVariant(variants:CatalogVariantView[],current:Partial<VariantAttributes>,axis:keyof VariantAttributes,value:string){
  const candidates=variants.filter(v=>v.offerCount>0&&v.attributes?.[axis]===value); if(!candidates.length) return null;
  const otherAxes=Object.entries(current).filter(([key,selected])=>key!==axis&&Boolean(selected));
  return [...candidates].sort((a,b)=>{
    const matchesA=otherAxes.filter(([key,selected])=>a.attributes[key as keyof VariantAttributes]===selected).length;
    const matchesB=otherAxes.filter(([key,selected])=>b.attributes[key as keyof VariantAttributes]===selected).length;
    return matchesB-matchesA||b.offerCount-a.offerCount||(a.bestPrice??Number.MAX_SAFE_INTEGER)-(b.bestPrice??Number.MAX_SAFE_INTEGER);
  })[0];
}

export default function ProductCard({product,query=''}:{product:ProductResult;query?:string;key?:string}){
  const [saving,setSaving]=useState(false); const [saved,setSaved]=useState(false); const [showAll,setShowAll]=useState(false); const [selected,setSelected]=useState<Partial<VariantAttributes>>({});
  const catalogVariants=useMemo(()=>(product.catalogVariants||[]).filter(v=>v.offerCount>0),[product.catalogVariants]);
  const axes=useMemo(()=>variantOptions(catalogVariants),[catalogVariants]);
  const variantCoverage=useMemo(()=>catalogVariants.map(variant=>({variant,stores:new Set(product.offers.filter(o=>o.variantId===variant.id).map(merchantKey)).size,best:Math.min(...product.offers.filter(o=>o.variantId===variant.id).map(o=>o.totalPrice))})),[catalogVariants,product.offers]);
  const bestCoverageVariant=useMemo(()=>[...variantCoverage].sort((a,b)=>b.stores-a.stores||b.variant.offerCount-a.variant.offerCount||a.best-b.best)[0]?.variant,[variantCoverage]);

  useEffect(()=>{
    const explicit=catalogVariants.find(v=>v.id===product.selectedVariantId);
    const queryHasVariant=AXIS_ORDER.some(axis=>Boolean(axes[axis]?.length&&queryChoice(query,axes[axis]!)));
    const fallback=queryHasVariant?(explicit||bestCoverageVariant||catalogVariants[0]):(bestCoverageVariant||explicit||catalogVariants[0]);
    if(!fallback){ setSelected({}); return; }
    const next={...fallback.attributes} as Partial<VariantAttributes>;
    for(const axis of AXIS_ORDER){ const values=axes[axis]; if(!values?.length) continue; const fromQuery=queryChoice(query,values); if(!fromQuery) continue; const candidate=chooseBestVariant(catalogVariants,next,axis,fromQuery); if(candidate) Object.assign(next,candidate.attributes); }
    setSelected(next); setShowAll(false);
  },[product.id,product.selectedVariantId,catalogVariants,bestCoverageVariant,axes,query]);

  const selectedCatalogVariant=useMemo(()=>catalogVariants.find(v=>sameSelection(v.attributes,selected))||[...catalogVariants].sort((a,b)=>b.offerCount-a.offerCount)[0],[catalogVariants,selected]);
  const selectedOffers=useMemo(()=>[...(selectedCatalogVariant?product.offers.filter(o=>o.variantId===selectedCatalogVariant.id):product.offers.filter(o=>sameSelection(o.variantData||{},selected)))].sort((a,b)=>a.totalPrice-b.totalPrice),[product.offers,selectedCatalogVariant,selected]);
  const stores=new Set(selectedOffers.map(merchantKey)).size;
  const allStores=new Set(product.offers.map(merchantKey)).size;
  const score=selectedScore(selectedOffers); const selectedBest=selectedOffers[0];
  const currentImage=selectedCatalogVariant?.image||selectedOffers.find(o=>Boolean(o.image))?.image||product.familyImage||product.image||'';
  const productHref=`/product/${encodeURIComponent(product.id)}${selectedCatalogVariant?.id?`?variantId=${encodeURIComponent(selectedCatalogVariant.id)}`:''}`;
  const visibleOffers=showAll?selectedOffers:selectedOffers.slice(0,4);

  function chooseVariant(axis:keyof VariantAttributes,value:string){ const candidate=chooseBestVariant(catalogVariants,selected,axis,value); if(!candidate) return; setSelected(candidate.attributes); setShowAll(false); }
  function offerHref(offer:OfferView){ if(offer.id) return `/api/out?offerId=${encodeURIComponent(offer.id)}`; return offer.url||productHref; }
  function openAnalysis(){ window.location.assign(productHref); }
  async function save(e:MouseEvent){ e.preventDefault(); e.stopPropagation(); if(!product.id||product.id.startsWith('family:')){ window.location.href='/login'; return; } setSaving(true); const response=await fetch('/api/wishlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({familyId:product.id,variantId:selectedCatalogVariant?.id})}); if(response.status===401) window.location.href='/login'; else if(response.ok) setSaved(true); setSaving(false); }

  return <article className="compare-row">
    <div className="compare-media">
      {currentImage?<img src={currentImage} alt={product.title} loading="lazy"/>:<div className="compare-image-fallback"><span>C</span><small>Nav attēla</small></div>}
    </div>

    <div className="compare-product">
      <div className="compare-kicker"><span>{product.brand||'Produkts'}</span><span>{allStores} {allStores===1?'veikals':'veikali'} kopā</span></div>
      <Link href={productHref} className="compare-title">{product.title}</Link>

      {AXIS_ORDER.some(axis=>Boolean(axes[axis]?.length))&&<div className="compare-variants">
        {AXIS_ORDER.map(axis=>{ const options=axes[axis]; if(!options||options.length<2) return null; return <div className="compare-axis" key={axis}><span>{AXIS_LABELS[axis]}</span><div>{options.map(option=><button type="button" key={option} className={selected[axis]===option?'active':''} onClick={()=>chooseVariant(axis,option)}>{option}</button>)}</div></div>; })}
      </div>}

      <div className="compare-summary">
        <div><span>No</span><strong>{selectedBest?money(selectedBest.totalPrice,selectedBest.currency):'—'}</strong></div>
        <div><span>Šim variantam</span><strong>{stores} {stores===1?'veikals':'veikali'}</strong></div>
        <div><span>CENIQ</span><strong className={score>0?'has-score':''}>{score>0?`${score}/100`:'—'}</strong></div>
      </div>
      <div className="compare-actions"><button type="button" onClick={openAnalysis}>Skatīt pilnu analīzi</button><button type="button" onClick={save} disabled={saving}>{saved?'♥ Saglabāts':'♡ Saglabāt'}</button></div>
    </div>

    <div className="compare-offers">
      <div className="compare-offers-head"><div><span>Veikalu cenas</span><strong>{selectedOffers.length?`${selectedOffers.length} piedāvājumi`:'Nav piedāvājumu'}</strong></div>{selectedOffers.length>1&&<small>sakārtots pēc cenas</small>}</div>
      {visibleOffers.length?<div className="compare-offer-list">{visibleOffers.map((offer,index)=><div className="compare-offer" key={offer.id||`${merchantKey(offer)}-${offer.totalPrice}-${index}`}>
        <div className="compare-store"><b>{offer.merchant}</b><span>{availability(offer)}</span></div>
        <div className="compare-price"><strong>{money(offer.totalPrice,offer.currency)}</strong>{offer.shippingKnown&&offer.shipping>0?<small>+ {money(offer.shipping,offer.currency)} piegāde</small>:null}</div>
        <a href={offerHref(offer)} target="_blank" rel="nofollow sponsored noopener">Veikals ↗</a>
      </div>)}</div>:<div className="compare-empty">Šim variantam vēl nav svaigu piedāvājumu.</div>}
      {selectedOffers.length>4&&<button type="button" className="compare-more" onClick={()=>setShowAll(v=>!v)}>{showAll?'Rādīt mazāk':`Vēl ${selectedOffers.length-4} piedāvājumi`}</button>}
    </div>
  </article>;
}
