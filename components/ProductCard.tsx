'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { CatalogVariantView, OfferView, ProductResult, VariantAttributes } from '@/lib/types';

const AXIS_ORDER: Array<keyof VariantAttributes> = ['storage','color','ram','connectivity','size','cpu','gpu','resolution','panelType','refreshRate','kit','condition'];
const AXIS_LABELS: Partial<Record<keyof VariantAttributes, string>> = {
  storage:'Atmiņa', color:'Krāsa', ram:'RAM', connectivity:'Savienojums', size:'Izmērs', cpu:'Procesors', gpu:'Grafika', resolution:'Izšķirtspēja', panelType:'Panelis', refreshRate:'Frekvence', kit:'Komplekts', condition:'Stāvoklis',
};

function money(value:number,currency='EUR') { try { return new Intl.NumberFormat('lv-LV',{style:'currency',currency}).format(value); } catch { return `${value.toFixed(2)} ${currency}`; } }
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
  const selectedBest=selectedOffers[0];
  const currentImage=selectedCatalogVariant?.image||selectedOffers.find(o=>Boolean(o.image))?.image||product.familyImage||product.image||'';
  const productHref=`/product/${encodeURIComponent(product.id)}${selectedCatalogVariant?.id?`?variantId=${encodeURIComponent(selectedCatalogVariant.id)}`:''}`;
  const visibleOffers=showAll?selectedOffers:selectedOffers.slice(0,5);

  function chooseVariant(axis:keyof VariantAttributes,value:string){ const candidate=chooseBestVariant(catalogVariants,selected,axis,value); if(!candidate) return; setSelected(candidate.attributes); setShowAll(false); }
  function offerHref(offer:OfferView){ if(offer.id) return `/api/out?offerId=${encodeURIComponent(offer.id)}`; return offer.url||productHref; }
  async function save(e:MouseEvent){ e.preventDefault(); e.stopPropagation(); if(!product.id||product.id.startsWith('family:')){ window.location.href='/login'; return; } setSaving(true); const response=await fetch('/api/wishlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({familyId:product.id,variantId:selectedCatalogVariant?.id})}); if(response.status===401) window.location.href='/login'; else if(response.ok) setSaved(true); setSaving(false); }

  return <article className="v7-product">
    <div className="v7-product-main">
      <div className="v7-media">{currentImage?<img src={currentImage} alt={product.title} loading="lazy"/>:<div className="v7-fallback"><b>C</b><span>nav attēla</span></div>}</div>
      <div className="v7-copy">
        <div className="v7-meta"><span className="v7-brand">{product.brand||'Produkts'}</span><span className="v7-stores">{allStores} {allStores===1?'veikals':'veikali'} katalogā</span></div>
        <Link href={productHref} className="v7-title">{product.title}</Link>
        {AXIS_ORDER.some(axis=>Boolean(axes[axis]?.length))&&<div className="v7-variants">{AXIS_ORDER.map(axis=>{ const options=axes[axis]; if(!options||options.length<2) return null; return <div className="v7-axis" key={axis}><span>{AXIS_LABELS[axis]}</span><div>{options.map(option=><button type="button" key={option} className={selected[axis]===option?'active':''} onClick={()=>chooseVariant(axis,option)}>{option}</button>)}</div></div>; })}</div>}
      </div>
      <aside className="v7-side">
        <div><div className="v7-price-label">Labākā cena</div><div className="v7-price">{selectedBest?money(selectedBest.totalPrice,selectedBest.currency):'—'}</div><div className="v7-price-note">{stores} {stores===1?'veikals':'veikali'} šim variantam</div></div>
        <div className="v7-side-actions"><Link href={productHref} className="v7-analysis">Pilna analīze</Link><button className="v7-save" type="button" onClick={save} disabled={saving}>{saved?'♥ Saglabāts':'♡ Saglabāt'}</button></div>
      </aside>
    </div>

    <div className="v7-market">
      <div className="v7-market-title"><b>Veikalu piedāvājumi</b><span>{selectedOffers.length} {selectedOffers.length===1?'piedāvājums':'piedāvājumi'}</span></div>
      {visibleOffers.length?visibleOffers.map((offer,index)=><div className="v7-offer" key={offer.id||`${merchantKey(offer)}-${offer.totalPrice}-${index}`}>
        <div className="v7-offer-store"><b>{offer.merchant}</b><small>{offer.merchantDomain||''}</small></div>
        <div className="v7-stock">{availability(offer)}</div>
        <div className="v7-offer-price"><b>{money(offer.totalPrice,offer.currency)}</b>{offer.shippingKnown&&offer.shipping>0?<small>+ {money(offer.shipping,offer.currency)} piegāde</small>:null}</div>
        <a href={offerHref(offer)} target="_blank" rel="nofollow sponsored noopener">Atvērt ↗</a>
      </div>):<div className="v7-empty">Šim variantam vēl nav svaigu piedāvājumu.</div>}
      {selectedOffers.length>5&&<button type="button" className="v7-more" onClick={()=>setShowAll(v=>!v)}>{showAll?'Rādīt mazāk':`Rādīt vēl ${selectedOffers.length-5}`}</button>}
    </div>
  </article>;
}
