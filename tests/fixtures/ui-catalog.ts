import type {ProductResult} from '../../lib/types.ts';
// Synthetic UI fixtures. Never imported by application or collector code.
export const fixtureProducts:ProductResult[]=['Samsung Galaxy S25','Apple iPhone 16'].map((title,index)=>{
 const id=`qa-${index}`;const catalogVariants=[{id:`${id}-128`,variantKey:'128',attributes:{storage:'128 GB',ram:'12 GB',color:'Navy',condition:'New'},offerCount:3,bestPrice:599},{id:`${id}-256`,variantKey:'256',attributes:{storage:'256 GB',ram:'12 GB',color:'Navy',condition:'New'},offerCount:2,bestPrice:649}];
 return {id,externalId:id,title,normalizedTitle:title.toLowerCase(),brand:index?'Apple':'Samsung',category:'smartphone',image:'https://cdn.tet.lv/tetveikals-prd-images/full_size/products/viedtalrunis-samsung-galaxy-s25-navy-9-6791fd606153d.jpg.webp',bestPrice:599,currency:'EUR',dealScore:88,storesCount:3,selectedVariantId:catalogVariants[0].id,catalogVariants,offers:catalogVariants.flatMap((v,vi)=>['Veikals A','Veikals B','Veikals C'].slice(0,v.offerCount).map((merchant,i)=>({id:`${v.id}-${i}`,variantId:v.id,variantData:v.attributes,merchant,merchantDomain:`fixture-${i}.invalid`,price:599+vi*50+i*25,totalPrice:599+vi*50+i*25,shipping:0,shippingKnown:true,currency:'EUR',dealScore:88-i*5,isCheapest:i===0,isBestOverall:i===0,deliveryMessage:'Testa pieejamības teksts'})))};
});

