import type { ProductResult, VariantAttributes } from '../types.ts';
import { canonicalizeMerchantProductTitle } from './title-normalization.ts';
import { normalizeText } from './domain.ts';

const GENERIC_CONTEXT = new Set(['phone','smartphone','mobile','laptop','notebook','computer','monitor','tv','television','headphones','headphone','camera','printer','speaker','router','smartwatch','product']);
const ACCESSORY = /\b(?:case|cover|screen protector|glass|charger|adapter|cable|maci[nņ]s|vaci[nņ]s|aizsargstikls|apvalks)\b/i;
const AXES: Array<keyof VariantAttributes> = ['storage','ram','color','connectivity','cpu','gpu','size','resolution','panelType','refreshRate','kit','condition'];

function phoneKey(value: string) {
  if (ACCESSORY.test(value)) return '';
  const iphone = value.match(/\b(?:Apple\s+)?iPhone\s+(\d{1,2})(?:\s*(e)\b|\s+(Pro\s+Max|Pro|Plus|Air|Mini|SE)\b)?/i);
  if (iphone) return `phone:apple:iphone:${iphone[1]}:${normalizeText(iphone[2] ? 'e' : iphone[3] || 'base')}`;
  const galaxy = value.match(/\b(?:Samsung\s+)?Galaxy\s+([A-Z]\d{1,3})(?:\s+(Ultra|Plus|FE))?\b/i);
  if (galaxy) return `phone:samsung:galaxy:${galaxy[1].toLowerCase()}:${normalizeText(galaxy[2] || 'base')}`;
  const patterns: Array<[RegExp,string]> = [
    [/\bHonor\s+(\d{2,3})(?:\s+(Lite|Pro|Pro\+|Ultra))?\b/i,'honor'],
    [/\bXiaomi\s+(\d{1,2}[A-Z]?)(?:\s+(Lite|Pro|Ultra|T|T Pro))?\b/i,'xiaomi'],
    [/\bOnePlus\s+(\d{1,2})(?:\s+(R|T|Pro))?\b/i,'oneplus'],
    [/\bNubia\s+(Neo\s+\d+(?:\s+GT)?|Z\d+(?:\s+Ultra)?)\b/i,'nubia'],
    [/\bBlackview\s+(Rugged\s+)?([A-Z]{1,4}\d{2,5})\b/i,'blackview'],
    [/\bSony\s+Xperia\s+(\d+\s+[IVX]+)\b/i,'sony-xperia'],
  ];
  for (const [pattern, brand] of patterns) { const match=value.match(pattern); if(!match)continue; return `phone:${brand}:${normalizeText(match.slice(1).filter(Boolean).join(' '))}`; }
  return '';
}

function modelToken(value: string) { const tokens=value.match(/[A-Za-z0-9][A-Za-z0-9._/-]*/g)||[]; const index=tokens.findIndex(token=>/[A-Za-z]/.test(token)&&/\d/.test(token)&&token.length>=2); if(index<0)return null; return {token:normalizeText(tokens[index]),index,tokens}; }
function strongKey(product: ProductResult) {
  const title=canonicalizeMerchantProductTitle(product.title,product.brand).title; if(ACCESSORY.test(title))return ''; const phone=phoneKey(title); if(phone)return phone;
  const brand=normalizeText(product.brand||''); if(!brand)return ''; const model=modelToken(title); if(!model)return '';
  const brandTokens=new Set(brand.split(' ').filter(Boolean)); const context=model.tokens.slice(Math.max(0,model.index-3),model.index).map(token=>normalizeText(token)).filter(token=>token&&!brandTokens.has(token)&&!GENERIC_CONTEXT.has(token)).slice(-2);
  return `model:${brand}:${context.join(':')}:${model.token}`;
}
function merchantKey(offer: ProductResult['offers'][number]) { return normalizeText(String(offer.merchantDomain||offer.merchant||'')); }
function attrsKey(attrs: VariantAttributes = {}) { return AXES.map(axis=>`${axis}:${normalizeText(String(attrs?.[axis]||''))}`).join('|'); }

export function collapseEquivalentVariants(product: ProductResult): ProductResult {
  const variants=product.catalogVariants||[]; if(variants.length<2)return product;
  const groups=new Map<string,typeof variants>(); for(const variant of variants){ const key=attrsKey(variant.attributes||{}); groups.set(key,[...(groups.get(key)||[]),variant]); }
  const idMap=new Map<string,string>(); const collapsed=[];
  for(const group of groups.values()){
    const representative=[...group].sort((a,b)=>b.offerCount-a.offerCount||(a.bestPrice??Number.MAX_SAFE_INTEGER)-(b.bestPrice??Number.MAX_SAFE_INTEGER))[0];
    const ids=new Set(group.map(v=>v.id)); const offers=product.offers.filter(o=>Boolean(o.variantId&&ids.has(o.variantId))); const bestPrice=offers.length?Math.min(...offers.map(o=>o.totalPrice)):representative.bestPrice;
    for(const variant of group)idMap.set(variant.id,representative.id);
    collapsed.push({...representative,offerCount:offers.length,bestPrice});
  }
  const offers=product.offers.map(offer=>offer.variantId&&idMap.has(offer.variantId)?{...offer,variantId:idMap.get(offer.variantId)}:offer);
  const selectedVariantId=product.selectedVariantId ? idMap.get(product.selectedVariantId)||product.selectedVariantId : undefined;
  return {...product,catalogVariants:collapsed,offers,selectedVariantId,storesCount:new Set(offers.map(merchantKey).filter(Boolean)).size};
}

export function reconcileStrongFamilies(input: ProductResult[]) {
  const groups=new Map<string,ProductResult[]>(); const singles:ProductResult[]=[];
  for(const product of input){ const key=strongKey(product); if(!key){singles.push(product);continue;} groups.set(key,[...(groups.get(key)||[]),product]); }
  const merged:ProductResult[]=[...singles.map(collapseEquivalentVariants)];
  for(const products of groups.values()){
    if(products.length===1){merged.push(collapseEquivalentVariants(products[0]));continue;}
    const base=[...products].sort((a,b)=>(b.offers?.length||0)-(a.offers?.length||0))[0];
    const offers=[...new Map(products.flatMap(product=>product.offers||[]).map(offer=>[offer.id||`${merchantKey(offer)}|${offer.url}|${offer.totalPrice}`,offer])).values()];
    const catalogVariants=[...new Map(products.flatMap(product=>product.catalogVariants||[]).map(variant=>[variant.id,variant])).values()];
    const canonicalTitles=products.map(product=>canonicalizeMerchantProductTitle(product.title,product.brand).title).filter(Boolean).sort((a,b)=>a.length-b.length);
    const bestPrice=offers.length?Math.min(...offers.map(offer=>offer.totalPrice)):base.bestPrice;
    merged.push(collapseEquivalentVariants({...base,title:canonicalTitles[0]||base.title,normalizedTitle:normalizeText(canonicalTitles[0]||base.title),image:products.find(product=>product.image)?.image||base.image,familyImage:products.find(product=>product.familyImage)?.familyImage||base.familyImage,offers,catalogVariants,storesCount:new Set(offers.map(merchantKey).filter(Boolean)).size,bestPrice,dealScore:Math.max(Number(base.dealScore||0),...offers.map(offer=>Number(offer.dealScore||0)))}));
  }
  return merged;
}
