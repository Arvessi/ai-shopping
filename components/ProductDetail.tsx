'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import PriceChart from './PriceChart';

type Product = any;
type Verdict = {
  verdict: 'PÄ“rc tagad' | 'Pagaidi' | 'SalÄ«dzini vÄ“l';
  summary: string;
  reasons: string[];
  confidence: 'zema' | 'vidÄ“ja' | 'augsta';
};

const AXIS_LABELS: Record<string,string> = {
  storage:'AtmiÅ†a', ram:'RAM', color:'KrÄsa', connectivity:'Savienojums', size:'IzmÄ“rs',
  cpu:'Procesors', gpu:'Grafika', resolution:'IzÅ¡Ä·irtspÄ“ja', panelType:'Panelis',
  refreshRate:'Frekvence', kit:'Komplekts', condition:'StÄvoklis',
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
function currentSpecs(attributes:Record<string,string>|undefined) {
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
    const sources=catalogVariants.length
      ? catalogVariants.map((variant:any)=>({variantData:variant.attributes}))
      : allOffers;
    for(const offer of sources) {
      for(const [key,value] of Object.entries(offer.variantData||{})) {
        if(!value||(key==='condition'&&value==='New')) continue;
        if(!map.has(key)) map.set(key,new Set());
        map.get(key)!.add(String(value));
      }
    }
    return Object.fromEntries(Array.from(map.entries()).map(([key,values])=>[key,Array.from(values)])) as Record<string,string[]>;
  },[allOffers,catalogVariants]);

  useEffect(()=>{
    if(Object.keys(selected).length||!allOffers.length) return;
    const canonicalDefault=catalogVariants.find((variant:any)=>variant.id===product?.selectedVariantId);
    if(canonicalDefault) { setSelected(canonicalDefault.attributes||{}); return; }
    const cheapest=[...allOffers].sort((a:any,b:any)=>a.totalPrice-b.totalPrice)[0];
    setSelected(cheapest?.variantData||{});
  },[allOffers,catalogVariants,product,selected]);

  const selectedVariant=useMemo(
    ()=>catalogVariants.find((variant:any)=>Object.entries(selected).every(([key,value])=>!value||variant.attributes?.[key]===value)),
    [catalogVariants,selected],
  );

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
    return allOffers
      .filter((offer:any)=>selectedVariant?offer.variantId===selectedVariant.id:matchVariant(offer,selected))
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
  const specs=currentSpecs(selectedVariant?.attributes||selected);

  async function runRefresh(force=false,silent=false) {
    if(refreshing||enriching) return;
    silent?setEnriching(true):setRefreshing(true);
    if(!silent) setError('');
    try {
      const start=await fetch(`/api/products/${encodeURIComponent(id)}/refresh?force=${force?'1':'0'}`,{method:'POST'});
      const startData=await start.json();
      if(!start.ok) throw new Error(startData.error||'NeizdevÄs atrast vairÄk piedÄvÄjumu.');
      if(!startData.pending) { await load(selectedVariant?.id); return; }

      let stage=startData.stage||'sellers';
      let taskId=startData.taskId;
      let retryAfterMs=750;
      for(let attempt=0;attempt<12;attempt+=1) {
        await new Promise(resolve=>setTimeout(resolve,retryAfterMs));
        const poll=await fetch(`/api/products/${encodeURIComponent(id)}/refresh?stage=${encodeURIComponent(stage)}&taskId=${encodeURIComponent(taskId)}`);
        const pollData=await poll.json();
        if(!poll.ok) throw new Error(pollData.error||'PiedÄvÄjumu atjaunoÅ¡ana neizdevÄs.');
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
      throw new Error('Veikalu meklÄ“Å¡ana aizÅ†Ä“mÃ a:dpu laiku.');
    } catch(e) {
      if(!silent) setError(e instanceof Error?e.message:'NeizdevÄs atjaunot.');
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
    const response=await fetch('/api/wishlist',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify˜[Z[RYœ›ÙXİšY˜\šX[YœÙ[XİY˜\šX[ËšYJKˆJNÂˆYŠ™\ÜÛœÙKœİ]\ÏOOMJHÈÚ[™İË›ØØ][Û‹š™YIËÛÙÚ[‰ÎÈ™]\›ÈBˆYŠ™\ÜÛœÙK›ÚÊHÙ]Ø]™Y
YJNÂˆB‚ˆ\Ş[˜È[˜İ[ÛˆÜ™X]P[\

HÂˆÙ][\\ÙÊ	ÉÊNÂˆÛÛœİ™\ÜÛœÙOX]ØZ]™]Ú
	ËØ\KØ[\ÉËÂˆY]Ù‰ÔÔÕ	ËXY\œÎÉĞÛÛ[U\IÎ‰Ø\XØ][Û‹ÚœÛÛ‰ßKˆ›ÙN’”ÓÓ‹œİš[™ÚYJÙ˜[Z[RYœ›ÙXİšY˜\šX[YœÙ[XİY˜\šX[ËšY\™Ù]šXÙN“[X™\Š\™Ù]
K[XZ[[˜X›YYKœ›İÜÙ\‘[˜X›YY_JKˆJNÂˆÛÛœİ]OX]ØZ]™\ÜÛœÙKšœÛÛŠ
NÂˆYŠ™\ÜÛœÙKœİ]\ÏOOMJHÈÚ[™İË›ØØ][Û‹š™YIËÛÙÚ[‰ÎÈ™]\›ÈBˆÙ][\\ÙÊ™\ÜÛœÙK›ÚÏÉĞœ±*Ù[± Z[\È^™ZYİÈ8§$Î™]K™\œ›ÜŸ	Ó™Z^™]± \È^™ZYİœ±*Ù[± Z[]K‰ÊNÂˆB‚ˆ\Ş[˜È[˜İ[ÛˆÙ]™\™Xİ

HÂˆYŠ™\™XİØY[™ÊH™]\›ÂˆÙ]™\™XİØY[™ÊYJNÂˆÙ]™\™Xİ\œ›ÜŠ	ÉÊNÂˆHÂˆÛÛœİ™\ÜÛœÙOX]ØZ]™]Ú
Ø\KÜ›ÙXİËÉÙ[˜ÛÙUT’PÛÛ\Û™[
Y
_Kİ™\™Xİ	ÜÙ[XİY˜\šX[ËšYØİ˜\šX[YIÙ[˜ÛÙUT’PÛÛ\Û™[
Ù[XİY˜\šX[šY
_X‰ÉßXÛY]Ù‰ÔÔÕ	ßJNÂˆÛÛœİ]OX]ØZ]™\ÜÛœÙKšœÛÛŠ
NÂˆYŠ\™\ÜÛœÙK›ÚÊH›İÈ™]È\œ›ÜŠ]K™\œ›ÜŸ	ĞÑS’TH[˜[1*Ş™H™Z^™]± \Ë‰ÊNÂˆÙ]™\™Xİ
]K™\™Xİ
NÂˆÙ]™\™Xİ›İšY\Š]Kœ›İšY\Ÿ	ÉÊNÂˆHØ]Ú
JHÂˆÙ]™\™Xİ\œ›ÜŠH[œİ[˜Ù[Ùˆ\œ›ÜÙK›Y\ÜØYÙN‰ĞÑS’TH[˜[0êŞ™H™Z^™]± \Ë‰ÊNÂˆHš[˜[HÂˆÙ]™\™XİØY[™Ê˜[ÙJNÂˆBˆB‚ˆYŠ\œ›Ü‰‰ˆ\›ÙXİ
H™]\›ˆ]ˆÛ\ÜÓ˜[YOH˜ÛÛZ[™\ˆÎK\İ[™[Û™H]ˆÛ\ÜÓ˜[YOH™\œ›Ü˜›ŞÙ\œ›ÜŸOÙ]Ù]ÂˆYŠ\›ÙXİ
H™]\›ˆ]ˆÛ\ÜÓ˜[YOH˜ÛÛZ[™\ˆÎK\İ[™[Û™H]ˆÛ\ÜÓ˜[YOH˜ÎK[ØY\ˆ’Y[1 Y1$ÈpèOÙ]Ù]Â‚ˆ™]\›ˆ
ˆ]ˆÛ\ÜÓ˜[YOH˜ÛÛZ[™\ˆÎKY]Z[‚ˆHÛ\ÜÓ˜[YOH˜ÎKX˜XÚÈˆ™YH‹È¸¡¤]ZØq/^ˆYZÛ1$ñhX[OØO‚‚ˆÙXİ[ÛˆÛ\ÜÓ˜[YOH˜ÎKY]Z[Z\›È‚ˆ]ˆÛ\ÜÓ˜[YOH˜ÎKY]Z[[YYXH‚ˆÜÙ[XİY[XYÙBˆÈ[YÈÜ˜Ï^ÜÙ[XİY[XYÙ_H[^Ü›ÙXİ]_KÏ‚ˆˆ]ˆÛ\ÜÓ˜[YOH˜ÎKY˜[˜XÚÈÏØÜ[˜]1$ÛÈYZÈ\[[± ]ÏÜÜ[Ù]ŸBˆÙ]‚‚ˆ]ˆÛ\ÜÓ˜[YOH˜ÎKY]Z[XÛÜH‚ˆ]ˆÛ\ÜÓ˜[YOH˜ÎKZÚXÚÙ\œÈ‚ˆÜ[ˆÛ\ÜÓ˜[YOH˜ÎKXœ˜[™Ü›ÙXİ˜œ˜[™	ĞÑS’TH›ÙZİÉßOÜÜ[‚ˆØ™\İØÛÜ™OŒ	‰Ü[ˆÛ\ÜÓ˜[YOH˜ÎK\ØÛÜ™HÑS’THØ™\İØÛÜ™_KÌLÜÜ[ŸBˆÜ[İİ[İÜ™PÛİ[Hİİ[İÜ™PÛİ[OOLOÉİ™ZZØ[ÉÎ‰İ™ZZØ[IßHØ][Ùñ OÜÜ[‚ˆÙ]‚ˆOÜ›ÙXİ]_OÚO‚‚ˆÜÜXÜË›[™İŒ	‰Šˆ]ˆÛ\ÜÓ˜[YOH˜ÎK\ÜXÜÈÎKY]Z[\ÜXÜÈ‚ˆÜÜXÜË›X\
][OOÜ[ˆÙ^O^Ø	Ôİš[™Ê][K˜^\Ê_KIÚ][K˜[Y_XOÛX[Ú][K›X™[OÜÛX[Ú][K˜[Y_OØÜÜ[Š_BˆÙ]‚ˆ
_B‚ˆÓØš™XİšÙ^\Ê˜\šX[Ü[ÛœÊK›[™İŒ	‰Šˆ]ˆÛ\ÜÓ˜[YOH˜ÎKY]Z[]˜\šX[È‚ˆĞVT×ÓÔ‘T‹›X\
^\ÏOÂˆÛÛœİÜ[ÛœÏ]˜\šX[Ü[ÛœÖØ^\×_×NÂˆYŠÜ[ÛœË›[™İLJH™]\›ˆ[Âˆ™]\›ˆ
ˆ]ˆÛ\ÜÓ˜[YOH˜ÎKX^\ÈˆÙ^O^Ø^\ßO‚ˆÜ[ĞVT×ÓP‘SÖØ^\×_OÜÜ[‚ˆ]ÛÜ[ÛœË›X\

Ü[ÛŠOO‚ˆ]Û‚ˆÙ^O^ÛÜ[ÛŸBˆÛ\ÜÓ˜[YO^ÜÙ[XİYØ^\×OOO[Ü[ÛÉØXİ]™IÎ‰ÉßBˆ\ØX›Y^Ğ›ÛÛX[ŠØ][ÙÕ˜\šX[Ë›[™İ
I‰ˆXØ][ÙÕ˜\šX[ËœÛÛYJ
˜\šX[˜[JOO‚ˆ˜\šX[˜]šX]\ÏË–Ø^\×OOO[Ü[Û‰‰“Øš™Xİ™[šY\ÊÙ[XİY
K™]™\J
ÚÙ^K˜[YWJOOšÙ^OOOX^\ß]˜[Y_˜\šX[˜]šX]\ÏË–ÚÙ^WOOO]˜[YJBˆ
_BˆÛÛXÚÏ^Ê
OO˜ÚÛÜÙU˜\šX[^\Ê^\ËÜ[ÛŠ_BˆÛÜ[ÛŸOØ]Û‚ˆ
_OÙ]‚ˆÙ]‚ˆ
NÂˆJ_BˆÙ]‚ˆ
_B‚ˆÙ[œšXÚ[™É‰]ˆÛ\ÜÓ˜[YOH˜ÎKY[œšXÚKÏÑS’TH›Û± H1 \˜˜]YH±$Û™ZZØ[\È[ˆ]1$Û\ø )Ù]ŸB‚ˆ]ˆÛ\ÜÓ˜[YOH˜ÎKY]Z[XXİ[ÛœÈ‚ˆ]ÛˆÛÛXÚÏ^İÚ\Ú\İOÜØ]™YÉø¦iHØYÛX± ]ÉÎ‰ø¦hHØYÛX± ]	ßOØ]Û‚ˆ]ÛˆÛ\ÜÓ˜[YOHœÙXÛÛ™\HˆÛÛXÚÏ^Ê
OOœ[”™Yœ™\Ú
YK˜[ÙJ_H\ØX›Y^Ü™Yœ™\Ú[™ßO‚ˆÜ™Yœ™\Ú[™ÏÉÓYZÛ1$ø )‰Îİ[İÜ™PÛİ[ÏÉĞ]˜\İ˜Z\± ZÂfV–¶ÇRs¢tF¦Væ÷B6Væ2wĞ¢Âö'WGFöãà¢ÂöF—cà¢ÂöF—cà ¢Æ6–FR6Æ74æÖSÒ&3’ÖFWF–Â×7VÖÖ'’#à¢Ç7ãäÆ,H¼H·G\HÌH6VæÂ÷7ãà¢Ç7G&öæsç¶&W7CöÖöæW’†&W7BçF÷FÅ&–6RÆ&W7Bæ7W'&Væ7’“¢~(	BwÓÂ÷7G&öæsà¢Ç6ÖÆÃç·7F÷&T6÷VçGÒ·7F÷&T6÷VçCÓÓÓòwfV–¶Ç2s¢wfV–¶Æ’wÒZ–Òf&–çFÓÂ÷6ÖÆÃà¢¶&W7BbcÆVÓç¶&W7BæÖW&6†çGÓÂöVÓçĞ¢ÆF—b6Æ74æÖSÒ&3’×66÷&R×æVÂ#à¢Ç7ãä4Tä•66÷&SÂ÷7ãà¢Æ#ç¶&W7E66÷&Sãö&W7E66÷&S¢~(	BwÓÂö#à¢Ç6ÖÆÃç¶&W7E66÷&Sãòrós¢wf¦rf—6Ö¢"fV–¶ÇW2wÓÂ÷6ÖÆÃà¢ÂöF—cà¢Âö6–FSà¢Â÷6V7F–öãà ¢¶W'&÷"bcÆF—b6Æ74æÖSÒ&W'&÷&&÷‚3’ÖFWF–ÂÖW'&÷"#ç¶W'&÷'ÓÂöF—cçĞ ¢Ç6V7F–öâ6Æ74æÖSÒ&3’ÖFWF–Â×6V7F–öâ#à¢ÆF—b6Æ74æÖSÒ&3’×6V7F–öâÖ†VB#à¢ÆF—cãÇ7ãådT”´ÅR”TLHlH¥TÔ“Â÷7ããÆƒ#ä·W"—&·BZòf&–çGSÂöƒ#ãÂöF—cà¢Çç¶f–ÇFW&VDöffW'2æÆVæwF‡Ò¶f–ÇFW&VDöffW'2æÆVæwFƒÓÓÓòw–VLHlH§V×2s¢w–VLHlH§VÖ’wÓÂ÷à¢ÂöF—cà ¢ÆF—b6Æ74æÖSÒ&3’ÖFWF–ÂÖöffW'2#à¢·f—6–&ÆTöffW'2æÆVæwFƒ÷f—6–&ÆTöffW'2æÖ‚†öffW#¦ç’Æ–æFWƒ¦çVÖ&W"“Óç°¢6öç7B—4&W7C×7F÷&T6÷VçCãÓ"bb†&W7Còæ–CööffW"æ–CÓÓÖ&W7Bæ–C¦–æFWƒÓÓÓ“°¢&WGW&â€¢Æ'F–6ÆR6Æ74æÖS×¶3’ÖFWF–ÂÖöffW"G¶—4&W7Còv—2Ö&W7Bs¢rwÖÒ¶W“×¶öffW"æ–GÇÆG¶ÖW&6†çD¶W’†öffW"—ÒÒG¶öffW"çF÷FÅ&–6WÒÒG¶–æFW‡ÖÓà¢ÆF—b6Æ74æÖSÒ&3’ÖöffW"×&æ²#ç¶—4&W7Cò~)ˆRs¥7G&–ær†–æFW‚³’çE7F'Bƒ"Âsr—ÓÂöF—cà¢ÆF—b6Æ74æÖSÒ&3’ÖöffW"×7F÷&R#à¢Æ#ç¶öffW"æÖW&6†çGÓÂö#à¢Ç6ÖÆÃç¶—4&W7Còt4Tä•—§lI6ÆRs¦öffW"æÖW&6†çDFöÖ–çÇÆöffW"çf&–çDÆ&VÇÇÂuH&&VLJ·G2–VLHlH§V×2wÓÂ÷6ÖÆÃà¢ÂöF—cà¢ÆF—b6Æ74æÖSÒ&3’ÖöffW"×7Fö6²#ç¶öffW"æFVÆ—fW'”ÖW76vWÇÂu–VV¦ÜJ¶'RH&&VLJ·BfV–¶ÌHwÓÂöF—cà¢ÆF—b6Æ74æÖSÒ&3’ÖöffW"×&–6R#à¢Æ#ç¶ÖöæW’†öffW"çF÷FÅ&–6RÆöffW"æ7W'&Væ7’—ÓÂö#à¢Ç6ÖÆÃç¶öffW"æFVÅ66÷&Sãbg7F÷&T6÷VçCãÓ#ö66÷&RG¶öffW"æFVÅ66÷&WÒó¢v¶÷I6¬H6VæwÓÂ÷6ÖÆÃà¢ÂöF—cà¢Æ‡&Vc×¶öffW"æ–Cöö’ö÷WCööffW$–CÒG¶Væ6öFUU$”6ö×öæVçB†öffW"æ–B—Ö¢†öffW"çW&ÇÇÂr2r—ÒF&vWCÒ%ö&Ææ²"&VÃÒ&æöföÆÆ÷r7öç6÷&VBæö÷VæW"#åW¢fV–¶ÇR(isÂöà¢Âö'F–6ÆSà¢“°¢Ò“£ÆF—b6Æ74æÖSÒ&3’ÖV×G’#ìZ’f&–çGR¶öÖ&–ìH6–¦’–VLHlH§V×2æbG&7G2ãÂöF—cçĞ¢ÂöF—cà ¢¶f–ÇFW&VDöffW'2æÆVæwFƒãRbb€¢Æ'WGFöâ6Æ74æÖSÒ&3’ÖÖ÷&R"öä6Æ–6³×²‚“Óç6WE6†÷tÆÂ‡fÇVSÓâfÇVR—Óà¢·6†÷tÆÃòu,HLJ·BÖ¬H²s¦,HLJ·Bf—7W2G¶f–ÇFW&VDöffW'2æÆVæwF‡Ò–VLHlH§V×W6Ğ¢Âö'WGFöãà¢—Ğ¢Â÷6V7F–öãà ¢Ç6V7F–öâ6Æ74æÖSÒ&3’ÖFWF–ÂÖw&–B#à¢ÆF—b6Æ74æÖSÒ&3’ÖFWF–Â×6V7F–öâ3’×fW&F–7B#à¢ÆF—b6Æ74æÖSÒ&3’×6V7F–öâÖ†VB#à¢ÆF—cãÇ7ãä4Tä•dU$D”5CÂ÷7ããÆƒ#ç·fW&F–7C÷fW&F–7BçfW&F–7C¢t¶ò6¶FF“òwÓÂöƒ#ãÂöF—cà¢·fW&F–7BbcÇç·fW&F–7Bæ6öæf–FVæ6WÒH&Æ–V<J¶&Â÷çĞ¢ÂöF—cà¢·fW&F–7Cò€¢Ãà¢Çç·fW&F–7Bç7VÖÖ'—ÓÂ÷à¢ÇVÃç·fW&F–7Bç&V6öç2æÖ‡&V6öãÓãÆÆ’¶W“×·&V6öçÓç·&V6öçÓÂöÆ“â—ÓÂ÷VÃà¢Ç6ÖÆÃç·fW&F–7E&÷f–FW#ÓÓÒvvVÖ–æ’sòt“¢vVÖ–æ’s¢t4Tä•æ÷FV–·V×RæÌJ·¦RwÓÂ÷6ÖÆÃà¢Âóà¢“¢€¢Ãà¢Çå6ÌJ¶G¦–æ’6VçRÂfV–¶ÇR6¶—GRVâ–VLHlH§VÖ·fÆ—LHF’f–VìHJ·<H6V6–ìH§VÜHãÂ÷à¢Æ'WGFöâöä6Æ–6³×¶vWEfW&F–7GÒF—6&ÆVC×·fW&F–7DÆöF–æwÓç·fW&F–7DÆöF–æsòtæÆ—¬I>(
bs¢u6XfV×B4Tä•f–VFö¶Æ’wÓÂö'WGFöãà¢Âóà¢—Ğ¢·fW&F–7DW'&÷"bcÇ6ÖÆÂ6Æ74æÖSÒ&3’×fW&F–7BÖW'&÷"#ç·fW&F–7DW'&÷'ÓÂ÷6ÖÆÃçĞ¢ÂöF—cà ¢ÆF—b6Æ74æÖSÒ&3’ÖFWF–Â×6V7F–öâ3’ÖÆW'B#à¢ÆF—b6Æ74æÖSÒ&3’×6V7F–öâÖ†VB#ãÆF—cãÇ7ãä4TåR%,J¤D”ìH¥TÕ3Â÷7ããÆƒ#å6¶’6gR6VçRãÂöƒ#ãÂöF—cãÂöF—cà¢ÆÆ&VÃäÜI7,Kv6Væ(*Â¢Æ–çWBG—SÒ&çVÖ&W""Ö–ãÒ#"7FWÒ#ã"fÇVS×·F&vWGÒöä6†ævS×²†S¤6†ævTWfVçCÄ…DÔÄ–çWDVÆVÖVçCâ“Óç6WEF&vWB†RçF&vWBçfÇVR—Òóà¢ÂöÆ&VÃà¢Æ'WGFöâöä6Æ–6³×¶7&VFTÆW'GÓä—§fV–F÷B',J¶F–ìH§V×SÂö'WGFöãà¢¶ÆW'D×6rbcÇ6ÖÆÃç¶ÆW'D×6wÓÂ÷6ÖÆÃçĞ¢ÂöF—cà¢Â÷6V7F–öãà ¢Ç6V7F–öâ6Æ74æÖSÒ&3’ÖFWF–Â×6V7F–öâ#à¢ÆF—b6Æ74æÖSÒ&3’×6V7F–öâÖ†VB#ãÆF—cãÇ7ãålI%5EU$SÂ÷7ããÆƒ#ä6Væ2F–æÖ–¶Âöƒ#ãÂöF—cãÂöF—cà¢Å&–6T6†'Bö–çG3×·&öGV7Bç6æ6†÷G7Ò7W'&Væ7“×·&öGV7Bæ7W'&Væ7—Òóà¢Â÷6V7F–öãà¢ÂöF—cà¢“°§Ğ