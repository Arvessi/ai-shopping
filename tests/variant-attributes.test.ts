import assert from 'node:assert/strict';
import test from 'node:test';
import { inferVariantAttributes } from '../collector/variant-attributes.ts';

test('infers phone storage color and connectivity',()=>{
  const attrs=inferVariantAttributes('Apple iPhone 17 256GB Black 5G');
  assert.equal(attrs.storage,'256GB');
  assert.equal(attrs.color,'Black');
  assert.equal(attrs.connectivity,'5G');
  assert.equal(attrs.condition,'New');
});

test('infers display size refresh and panel',()=>{
  const attrs=inferVariantAttributes('LG OLED 55" 4K 120Hz TV');
  assert.equal(attrs.size,'55"');
  assert.equal(attrs.panelType,'OLED');
  assert.equal(attrs.resolution,'4K');
  assert.equal(attrs.refreshRate,'120Hz');
});

test('keeps open-box condition separate',()=>{
  const attrs=inferVariantAttributes('Samsung Galaxy S25 Ultra 256GB izpakota ierīce');
  assert.equal(attrs.condition,'Open box');
});
