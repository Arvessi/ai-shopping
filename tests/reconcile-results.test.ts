import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileStrongFamilies } from '../lib/canonical/reconcile-results.ts';
import type { ProductResult } from '../lib/types.ts';

function product(id:string,title:string,brand:string,merchant:string,price:number):ProductResult{
  return { id, externalId:id, title, normalizedTitle:title.toLowerCase(), brand, bestPrice:price, currency:'EUR', dealScore:0, storesCount:1, catalogVariants:[], variants:[], offers:[{ id:`o-${id}`, merchant, merchantDomain:`${merchant.toLowerCase()}.lv`, price, shipping:0, totalPrice:price, currency:'EUR', dealScore:0, isCheapest:true, isBestOverall:true }] };
}

test('merges numeric Honor phone families across merchants',()=>{
  const result=reconcileStrongFamilies([
    product('a','HONOR 400 Lite Dual Sim - 5109BRUX','Honor','M79',210),
    product('b','Honor 400 Lite','Honor','Bite',229),
  ]);
  assert.equal(result.length,1);
  assert.equal(result[0].storesCount,2);
  assert.equal(result[0].offers.length,2);
});

test('does not merge an accessory with its phone',()=>{
  const result=reconcileStrongFamilies([
    product('a','Honor 400 Lite','Honor','Bite',229),
    product('b','Cover for Honor 400 Lite','Honor','M79',3.3),
  ]);
  assert.equal(result.length,2);
});
