import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyVariantOutlierValidation,
  chooseImage,
  enrichmentLimitState,
  merchantDomainAllowed,
  normalizeAvailability,
  providerTaskState,
  resolveCandidate,
  scoreExactVariant,
  selectVariantForQuery,
  validVariantSelections,
  type NormalizedOfferCandidate,
} from '../lib/canonical/domain.ts';

type FixtureRow = { title: string; brand: string; gtin?: string; mpn?: string; price: number; displayedPrice?: string; description?: string; merchant: string; domain: string; url: string; image?: string };
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/shopping-regressions.json', import.meta.url), 'utf8')) as Record<string, FixtureRow[]>;

function candidate(row: FixtureRow): NormalizedOfferCandidate {
  return {
    source: 'fixture', sourceKey: row.url, merchant: { name: row.merchant, domain: row.domain },
    title: row.title, brand: row.brand, description: row.description, url: row.url, price: row.price,
    identifiers: row.gtin ? [{ type: 'GTIN', value: row.gtin, source: 'fixture' }] : row.mpn ? [{ type: 'MPN', value: row.mpn, source: 'fixture' }] : [],
    image: row.image ? { url: row.image, source: 'fixture', provenance: 'variant', confidence: 0.9 } : undefined,
    evidence: { displayedPrice: row.displayedPrice, explicitOneTime: !row.displayedPrice || !/month|payment|x/i.test(row.displayedPrice) },
  };
}

test('iPhone family is canonical while Pro remains separate and variants are real', () => {
  const resolved = fixtures.iphone.map((row) => resolveCandidate(candidate(row)));
  const base = resolved.filter((row) => !/\bPro\b/.test(row.title));
  const pro = resolved.find((row) => /\bPro\b/.test(row.title))!;
  assert.equal(new Set(base.map((row) => row.familyKey)).size, 1);
  assert.notEqual(base[0].familyKey, pro.familyKey);
  assert.equal(new Set(base.map((row) => row.variantKey)).size, 3);
  assert.deepEqual(new Set(base.map((row) => row.attributes.storage)), new Set(['128GB', '256GB']));
  assert.equal(base.filter((row) => row.variantKey === base[0].variantKey).length, 2);
  assert.notEqual(base.find((row) => row.attributes.color === 'Black')?.image?.url, base.find((row) => row.attributes.color === 'White')?.image?.url);
});

test('monthly/deposit price is rejected and cannot remain the lower accepted offer', () => {
  const resolved = fixtures.samsung.map((row) => resolveCandidate(candidate(row)));
  assert.equal(resolved[0].priceKind, 'DEPOSIT');
  assert.equal(resolved[0].validationStatus, 'REJECTED');
  assert.equal(resolved[1].priceKind, 'ONE_TIME');
  assert.equal(resolved[1].validationStatus, 'ACCEPTED');
  assert.deepEqual(applyVariantOutlierValidation(resolved).filter((row) => row.validationStatus === 'ACCEPTED').map((row) => row.price), [849]);
});

test('long laptop titles resolve generically through brand plus MPN', () => {
  const resolved = fixtures.laptop.map((row) => resolveCandidate(candidate(row)));
  assert.equal(new Set(resolved.map((row) => row.familyKey)).size, 1);
  assert.equal(resolved[0].variantKey, resolved[1].variantKey);
  assert.notEqual(resolved[0].variantKey, resolved[2].variantKey);
  assert.ok(resolved[0].attributes.cpu);
  assert.ok(resolved[0].attributes.gpu);
  assert.equal(resolved[2].attributes.ram, '32GB');
});

test('close exact-variant prices have close scores', () => {
  const scored = scoreExactVariant([
    { merchantKey: 'a', totalPrice: 879, trust: 4, available: true, confidence: 0.9, fresh: true },
    { merchantKey: 'b', totalPrice: 889, trust: 4, available: true, confidence: 0.9, fresh: true },
  ]);
  assert.ok(Math.abs(scored[0].score - scored[1].score) <= 3);
});

test('provider states distinguish pending, success, terminal failure and timeout policy inputs', () => {
  assert.equal(providerTaskState({ status_code: 40601 }).state, 'pending');
  assert.equal(providerTaskState({ status_code: 20000, result: [] }).state, 'succeeded');
  assert.equal(providerTaskState({ status_code: 40501, status_message: 'failed' }).state, 'failed');
  assert.equal(providerTaskState({ status_code: 20000 }).state, 'failed');
  assert.deepEqual(enrichmentLimitState({ deadlineAt: new Date(0), attempts: 0, maxAttempts: 9, now: new Date(1) }), { allowed: false, reason: 'deadline' });
  assert.deepEqual(enrichmentLimitState({ deadlineAt: new Date(100), attempts: 9, maxAttempts: 9, now: new Date(1) }), { allowed: false, reason: 'attempts' });
  assert.deepEqual(enrichmentLimitState({ deadlineAt: new Date(100), attempts: 1, maxAttempts: 9, now: new Date(1) }), { allowed: true });
});

test('variant image beats offer and family images', () => {
  assert.equal(chooseImage([
    { url: 'https://img.example/offer.jpg', source: 'merchant', provenance: 'offer', confidence: 1 },
    { url: 'https://img.example/variant.jpg', source: 'feed', provenance: 'variant', confidence: 0.8 },
  ], 'https://img.example/family.jpg'), 'https://img.example/variant.jpg');
  assert.equal(chooseImage([], 'https://img.example/family.jpg'), 'https://img.example/family.jpg');
});

test('variant matrix returns only real combinations', () => {
  const variants = [
    { id: 'black-128', attributes: { storage: '128GB', color: 'Black' } },
    { id: 'white-256', attributes: { storage: '256GB', color: 'White' } },
  ];
  assert.deepEqual(validVariantSelections(variants, { storage: '128GB', color: 'White' }), []);
  assert.deepEqual(validVariantSelections(variants, { storage: '128GB' }).map((row) => row.id), ['black-128']);
});

test('query selects the exact requested branch and never falls back to another variant price', () => {
  const variants = [
    { id: '128-black', attributes: { storage: '128GB', color: 'Black' }, offerCount: 0 },
    { id: '256-black', attributes: { storage: '256GB', color: 'Black' }, offerCount: 2, bestPrice: 999 },
  ];
  const selected = selectVariantForQuery(variants, 'iPhone 16 128GB Black');
  assert.equal(selected?.id, '128-black');
  assert.equal(selected?.bestPrice, undefined);
});

test('generic electronics categories use the same resolver', () => {
  const resolved = fixtures.generic.map((row) => resolveCandidate(candidate(row)));
  assert.equal(resolved.length, 4);
  assert.ok(resolved.every((row) => row.validationStatus === 'ACCEPTED'));
  assert.equal(resolved[0].attributes.size, '55 inch');
  assert.equal(resolved[0].attributes.panelType, 'OLED');
  assert.equal(resolved[1].attributes.resolution, '4K');
  assert.equal(resolved[1].attributes.refreshRate, '60Hz');
  assert.equal(resolved[3].attributes.kit !== undefined, true);
});

test('review/spec domains are not merchant candidates', () => {
  const allowed = new Set(['1a.lv', 'rdveikals.lv']);
  assert.equal(merchantDomainAllowed('gsmarena.com', allowed), false);
  assert.equal(merchantDomainAllowed('www.1a.lv', allowed), true);
});

test('availability is normalized centrally for every source', () => {
  assert.equal(normalizeAvailability('Ir pieejams noliktavā'), 'in_stock');
  assert.equal(normalizeAvailability('OUT OF STOCK'), 'out_of_stock');
  assert.equal(normalizeAvailability('Pre-order'), 'preorder');
});
