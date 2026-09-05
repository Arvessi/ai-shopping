import assert from 'node:assert/strict';
import test from 'node:test';
import { collapseEquivalentVariants, reconcileStrongFamilies } from '../lib/canonical/reconcile-results.ts';
import type { ProductResult } from '../lib/types.ts';

function product(id:string,title:string,brand:string,merchant:string,price:number):ProductResult{
  return { id, externalId:id, title, normalizedTitle:title.toLowerCase(), brand, bestPrice:price, currency:'EUR', dealScore:0, storesCount:1, catalogVariants:[], variants:[], offers:[{ id:`o-${id}`, merchant, merchantDomain:`${merchant.toLowerCase()}.lv`, price, shipping:0, totalPrice:price, currency:'EUR', dealScore:0, isCheapest:true, isBestOverall:true }] };
}

test('merges numeric Honor phone families across merchants',()=>{
  const result=reconcileStrongFamilies([product('a','HONOR 400 Lite Dual Sim - 5109BRUX','Honor','M79',210),product('b','Honor 400 Lite','Honor','Bite',229)]);
  assert.equal(result.length,1); assert.equal(result[0].storesCount,2); assert.equal(result[0].offers.length,2);
});

test('does not merge an accessory with its phone',()=>{
  const result=reconcileStrongFamilies([product('a','Honor 400 Lite','Honor','Bite',229),product('b','Cover for Honor 400 Lite','Honor','M79',3.3)]);
  assert.equal(result.length,2);
});

test('collapses equivalent variant ids so one variant can show multiple merchants',()=>{
  const base:ProductResult={id:'p',externalId:'p',title:'Apple iPhone 17',normalizedTitle:'apple iphone 17',brand:'Apple',bestPrice:800,currency:'EUR',dealScore:90,storesCount:2,selectedVariantId:'v1',catalogVariants:[
    {id:'v1',variantKey:'a',attributes:{storage:'256GB',condition:'New'},offerCount:1,bestPrice:800},
    {id:'v2',variantKey:'b',attributes:{storage:'256GB',condition:'New'},offerCount:1,bestPrice:820},
  ],offers:[
    {id:'o1',variantId:'v1',merchant:'A',merchantDomain:'a.lv',price:800,shipping:0,totalPrice:800,currency:'EUR',dealScore:90,isCheapest:true,isBestOverall:true},
    {id:'o2',variantId:'v2',merchant:'B',merchantDomain:'b.lv',price:820,shipping:0,totalPrice:820,currency:'EUR',dealScore:85,isCheapest:false,isBestOverall:false},
  ]};
  const result=collapseEquivalentVariants(base);
  assert.equal(result.catalogVariants?.length,1);
  assert.equal(result.offers.filter(o=>o.variantId===result.selectedVariantId).length,2);
  assert.equal(result.storesCount,2);
});
