import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDiscoveryDomains } from '../collector/discovery.ts';

test('explicit discovery domain clusters override the global merchant allowlist', () => {
  const domains = resolveDiscoveryDomains({
    knownMerchantsOnly: true,
    includeDomains: ['https://220.lv', 'www.dateks.lv', 'https://evelatus.lv/path'],
  });
  assert.deepEqual(domains.sort(), ['220.lv','dateks.lv','evelatus.lv'].sort());
});

test('discovery domain clusters honor explicit exclusions', () => {
  const domains = resolveDiscoveryDomains({
    knownMerchantsOnly: true,
    includeDomains: ['220.lv','dateks.lv','evelatus.lv'],
    excludeDomains: ['https://dateks.lv'],
  });
  assert.deepEqual(domains.sort(), ['220.lv','evelatus.lv'].sort());
});
