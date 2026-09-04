import assert from 'node:assert/strict';
import test from 'node:test';
import { persistCollectedOffers } from '../collector/canonical-bridge.ts';
import { isRestrictedShoppingQuery } from '../lib/safety.ts';

test('shopping query safety blocks restricted categories while allowing ordinary retail', () => {
  assert.equal(isRestrictedShoppingQuery('Samsung Galaxy S25 256GB'), false);
  assert.equal(isRestrictedShoppingQuery('Lenovo Legion laptop'), false);
  assert.equal(isRestrictedShoppingQuery('nicotine vape device'), true);
  assert.equal(isRestrictedShoppingQuery('ammunition'), true);
  assert.equal(isRestrictedShoppingQuery('online casino'), true);
});

test('collector persistence rejects restricted catalogue items before database access', async () => {
  const result = await persistCollectedOffers([{
    merchantSlug: 'test-store',
    merchantName: 'Test Store',
    merchantCountry: 'LV',
    url: 'https://example.com/restricted-item',
    title: 'Nicotine vape device',
    price: 10,
    currency: 'EUR',
    fetchedAt: new Date(0).toISOString(),
  }]);

  assert.equal(result.examined, 1);
  assert.equal(result.accepted, 0);
  assert.equal(result.rejected, 1);
  assert.equal(result.rejectionReasons['restricted-catalog-category'], 1);
});
