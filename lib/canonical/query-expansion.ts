import { normalizeText } from './domain';
import { canonicalizeMerchantProductTitle } from './title-normalization';

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizeText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasStorage(value: string) {
  return /\b(?:64|128|256|512|1024)\s*GB\b|\b1\s*TB\b/i.test(value);
}

function iphoneQueries(query: string) {
  const match = query.match(/\b(?:Apple\s+)?iPhone\s+(\d{1,2})(?:\s*(e)|\s+(Pro\s+Max|Pro|Plus|Air|Mini|SE))?\b/i);
  if (!match) return [];

  const generation = match[1];
  const trailingE = Boolean(match[2]);
  const modifier = trailingE ? 'e' : (match[3] || '').replace(/\s+/g, ' ').trim();
  const base = `iPhone ${generation}${modifier ? ` ${modifier}` : ''}`;
  const storages = modifier.toLowerCase().includes('pro') ? ['128GB', '256GB', '512GB', '1TB'] : ['128GB', '256GB', '512GB'];
  const expanded = [query];

  if (!hasStorage(query)) expanded.push(...storages.map((storage) => `${base} ${storage}`));
  if (!modifier) {
    expanded.push(
      `iPhone ${generation} Pro`,
      `iPhone ${generation} Pro Max`,
      `iPhone ${generation} Plus`,
      `iPhone ${generation}e`,
    );
  }

  return unique(expanded).slice(0, 9);
}

function galaxyQueries(query: string) {
  const match = query.match(/\b(?:Samsung\s+)?Galaxy\s+([A-Z]\d{1,3})(?:\s+(Ultra|Plus|FE))?\b/i);
  if (!match) return [];

  const model = match[1].toUpperCase();
  const modifier = match[2] || '';
  const base = `Samsung Galaxy ${model}${modifier ? ` ${modifier}` : ''}`;
  const expanded = [query];

  if (!hasStorage(query)) expanded.push(`${base} 128GB`, `${base} 256GB`, `${base} 512GB`);
  if (!modifier) expanded.push(`Samsung Galaxy ${model} Plus`, `Samsung Galaxy ${model} Ultra`, `Samsung Galaxy ${model} FE`);
  return unique(expanded).slice(0, 8);
}

function genericQueries(query: string) {
  const canonical = canonicalizeMerchantProductTitle(query).title;
  const base = canonical || query;

  // Generic discovery must work for the whole catalogue, not only the two phone
  // families we use for testing. These are search-intent variants, not invented
  // product variants, so they are safe for laptops, TVs, headphones, cameras, etc.
  return unique([
    query,
    canonical,
    `${base} cena`,
    `${base} Latvija`,
    `${base} price`,
  ]).slice(0, 5);
}

export function expandDiscoveryQueries(query: string) {
  const value = query.trim();
  if (!value) return [];

  const iphone = iphoneQueries(value);
  if (iphone.length) return iphone;

  const galaxy = galaxyQueries(value);
  if (galaxy.length) return galaxy;

  return genericQueries(value);
}
