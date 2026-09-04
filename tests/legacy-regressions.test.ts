import assert from 'node:assert/strict';
import test from 'node:test';
import { mapFastProductSearch, taskPending } from '../lib/dataforseo.ts';

test('terminal provider errors are not reported as pending', () => {
  const response = { tasks: [{ status_code: 40501, status_message: 'Task failed' }] };
  assert.equal(taskPending(response), false);
});

test('near-identical prices for the same variant remain close', () => {
  const response = { tasks: [{ status_code: 20000, result: [{ items: [
    { type: 'shopping', title: 'Apple iPhone 16 128GB Black', domain: '1a.lv', seller: '1a.lv', price: { current: 879, currency: 'EUR' }, url: 'https://1a.lv/a' },
    { type: 'shopping', title: 'Apple iPhone 16 128GB Black', domain: 'rdveikals.lv', seller: 'RD', price: { current: 889, currency: 'EUR' }, url: 'https://rdveikals.lv/b' }
  ] }] }] };
  const product = mapFastProductSearch(response)[0];
  assert.ok(product);
  assert.ok(Math.abs(product.offers[0].dealScore - product.offers[1].dealScore) <= 5);
});

test('a monthly payment cannot become the selected full price', () => {
  const response = { tasks: [{ status_code: 20000, result: [{ items: [
    { type: 'shopping', title: 'Samsung Galaxy S25 256GB Navy', description: 'tariff plan', domain: 'tet.lv', seller: 'Tet', price: { current: 80, displayed_price: '80 EUR first payment' }, url: 'https://tet.lv/plan' },
    { type: 'shopping', title: 'Samsung Galaxy S25 256GB Navy', domain: '1a.lv', seller: '1a.lv', price: { current: 849, displayed_price: '849 EUR' }, url: 'https://1a.lv/full' }
  ] }] }] };
  const product = mapFastProductSearch(response)[0];
  assert.ok(product);
  assert.deepEqual(product.offers.map((offer) => offer.price), [849]);
});
