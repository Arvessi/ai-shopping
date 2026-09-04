import assert from 'node:assert/strict';
import test from 'node:test';
import { mapShoppingCandidates } from '../lib/canonical/dataforseo-client.ts';
import { resolveCandidate } from '../lib/canonical/domain.ts';
import { expandDiscoveryQueries } from '../lib/canonical/query-expansion.ts';
import { canonicalizeMerchantProductTitle } from '../lib/canonical/title-normalization.ts';

test('generic Sony headphones are accepted without a provider GTIN or MPN', () => {
  const candidates = mapShoppingCandidates({
    __ceniqKeywords: ['Sony WH-1000XM5'],
    tasks: [{
      result: [{ items: [{
        product_id: 'google-sony-xm5',
        title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones Black',
        seller_name: '1a.lv',
        domain: '1a.lv',
        url: 'https://1a.lv/sony-wh1000xm5',
        price: { current: 329, currency: 'EUR' },
      }] }],
    }],
  });

  assert.equal(candidates.length, 1);
  const resolved = resolveCandidate(candidates[0]);
  assert.equal(resolved.validationStatus, 'ACCEPTED');
  assert.equal(resolved.priceKind, 'ONE_TIME');
  assert.match(resolved.familyTitle, /Sony/i);
  assert.match(resolved.familyTitle, /WH-?1000XM5/i);
});

test('discovery query context supplies missing storage for a MacBook result', () => {
  const candidates = mapShoppingCandidates({
    __ceniqKeywords: ['MacBook Air 256GB'],
    tasks: [{
      result: [{ items: [{
        product_id: 'google-macbook-air',
        title: 'Apple MacBook Air M3 Midnight',
        seller_name: 'Dateks',
        domain: 'dateks.lv',
        url: 'https://dateks.lv/macbook-air-m3',
        price: { current: 1099, currency: 'EUR' },
      }] }],
    }],
  });

  assert.equal(candidates[0]?.attributes?.storage, '256GB');
  assert.equal(resolveCandidate(candidates[0]).validationStatus, 'ACCEPTED');
});

test('generic merchant titles converge while product variants are stripped from family identity', () => {
  const sonyA = canonicalizeMerchantProductTitle('Sony WH-1000XM5 Wireless Noise Cancelling Headphones Black');
  const sonyB = canonicalizeMerchantProductTitle('Austiņas Sony WH-1000XM5, melna - Euronics');
  assert.equal(sonyA.title.toLowerCase(), sonyB.title.toLowerCase());

  const lgA = canonicalizeMerchantProductTitle('LG OLED C4 55 inch 4K TV Black');
  const lgB = canonicalizeMerchantProductTitle('Televizors LG OLED C4 55\" UHD - Euronics');
  assert.equal(lgA.title.toLowerCase(), lgB.title.toLowerCase());
});

test('iPhone sibling models remain separate canonical families', () => {
  assert.equal(canonicalizeMerchantProductTitle('Apple iPhone 16 128GB Black').title, 'Apple iPhone 16');
  assert.equal(canonicalizeMerchantProductTitle('Apple iPhone 16 Pro 256GB Black').title, 'Apple iPhone 16 Pro');
  assert.equal(canonicalizeMerchantProductTitle('Apple iPhone 16e 128GB White').title, 'Apple iPhone 16e');
});

test('generic query expansion is not phone-only', () => {
  const queries = expandDiscoveryQueries('Sony WH-1000XM5');
  assert.ok(queries.some((value) => /Sony WH-1000XM5/i.test(value)));
  assert.ok(queries.some((value) => /Latvija/i.test(value)));

  const laptop = expandDiscoveryQueries('Lenovo Legion 5');
  assert.ok(laptop.some((value) => /Lenovo Legion 5/i.test(value)));
});
