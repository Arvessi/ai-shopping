import assert from 'node:assert/strict';
import test from 'node:test';
import { mapShoppingCandidates, shoppingTasksReadyIds } from '../lib/canonical/dataforseo-client.ts';
import { merchantDomainAllowed, resolveCandidate } from '../lib/canonical/domain.ts';

test('DataForSEO Merchant output emits the shared candidate contract without hiding price evidence', () => {
  const candidates = mapShoppingCandidates({ tasks: [{ status_code: 20000, result: [{ items: [
    {
      product_id: 'google-product-1', title: 'Example Phone 256GB Black', brand: 'Example',
      seller_name: 'Latvian Store', domain: '1a.lv', url: 'https://1a.lv/example-phone',
      price: { current: 849, currency: 'EUR', displayed_price: '849 EUR' }, product_availability: 'in stock',
      image_url: 'https://img.example/phone-black.jpg',
    },
    {
      product_id: 'google-product-1-plan', title: 'Example Phone 256GB Black - 24 x 35 EUR', brand: 'Example',
      seller_name: 'Carrier', domain: 'tet.lv', url: 'https://tet.lv/example-phone-plan',
      price: { current: 35, currency: 'EUR', displayed_price: '35 EUR / month' }, installment_count: 24,
    },
  ] }] }] });
  assert.equal(candidates.length, 2);
  assert.equal(resolveCandidate(candidates[0]).priceKind, 'ONE_TIME');
  assert.equal(resolveCandidate(candidates[1]).priceKind, 'MONTHLY');
  assert.equal(resolveCandidate(candidates[1]).validationStatus, 'REJECTED');
  assert.equal(merchantDomainAllowed(candidates[0].merchant.domain, ['1a.lv']), true);
});

test('DataForSEO products tasks_ready exposes completed provider task IDs', () => {
  const ids = shoppingTasksReadyIds({
    status_code: 20000,
    tasks: [{
      status_code: 20000,
      result: [
        { id: 'ready-task-1', endpoint_advanced: '/v3/merchant/google/products/task_get/advanced/ready-task-1' },
        { id: 'ready-task-2', endpoint_advanced: '/v3/merchant/google/products/task_get/advanced/ready-task-2' },
      ],
    }],
  });

  assert.equal(ids.has('ready-task-1'), true);
  assert.equal(ids.has('ready-task-2'), true);
  assert.equal(ids.has('missing-task'), false);
});
