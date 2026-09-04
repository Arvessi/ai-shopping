import type { ProductResult } from '../types.ts';
import { canonicalizeMerchantProductTitle } from './title-normalization.ts';
import { normalizeText } from './domain.ts';

const GENERIC_CONTEXT = new Set(['phone','smartphone','mobile','laptop','notebook','computer','monitor','tv','television','headphones','headphone','camera','printer','speaker','router','smartwatch','product']);

function phoneKey(value: string) {
  const iphone = value.match(/\b(?:Apple\s+)?iPhone\s+(\d{1,2})(?:\s*(e)\b|\s+(Pro\s+Max|Pro|Plus|Air|Mini|SE)\b)?/i);
  if (iphone) return `phone:apple:iphone:${iphone[1]}:${normalizeText(iphone[2] ? 'e' : iphone[3] || 'base')}`;
  const galaxy = value.match(/\b(?:Samsung\s+)?Galaxy\s+([A-Z]\d{1,3})(?:\s+(Ultra|Plus|FE))?\b/i);
  if (galaxy) return `phone:samsung:galaxy:${galaxy[1].toLowerCase()}:${normalizeText(galaxy[2] || 'base')}`;
  return '';
}

function modelToken(value: string) {
  const tokens = value.match(/[A-Za-z0-9][A-Za-z0-9._/-]*/g) || [];
  const index = tokens.findIndex((token) => /[A-Za-z]/.test(token) && /\d/.test(token) && token.length >= 2);
  if (index < 0) return null;
  return { token: normalizeText(tokens[index]), index, tokens };
}

function strongKey(product: ProductResult) {
  const title = canonicalizeMerchantProductTitle(product.title, product.brand).title;
  const phone = phoneKey(title);
  if (phone) return phone;

  const brand = normalizeText(product.brand || '');
  if (!brand) return '';
  const model = modelToken(title);
  if (!model) return '';

  const brandTokens = new Set(brand.split(' ').filter(Boolean));
  const context = model.tokens
    .slice(Math.max(0, model.index - 3), model.index)
    .map((token) => normalizeText(token))
    .filter((token) => token && !brandTokens.has(token) && !GENERIC_CONTEXT.has(token))
    .slice(-2);

  return `model:${brand}:${context.join(':')}:${model.token}`;
}

function merchantKey(offer: ProductResult['offers'][number]) {
  return normalizeText(String(offer.merchantDomain || offer.merchant || ''));
}

export function reconcileStrongFamilies(input: ProductResult[]) {
  const groups = new Map<string, ProductResult[]>();
  const singles: ProductResult[] = [];

  for (const product of input) {
    const key = strongKey(product);
    if (!key) {
      singles.push(product);
      continue;
    }
    groups.set(key, [...(groups.get(key) || []), product]);
  }

  const merged: ProductResult[] = [...singles];
  for (const products of groups.values()) {
    if (products.length === 1) {
      merged.push(products[0]);
      continue;
    }

    const base = [...products].sort((a, b) => (b.offers?.length || 0) - (a.offers?.length || 0))[0];
    const offers = [...new Map(products.flatMap((product) => product.offers || []).map((offer) => [offer.id || `${merchantKey(offer)}|${offer.url}|${offer.totalPrice}`, offer])).values()];
    const catalogVariants = [...new Map(products.flatMap((product) => product.catalogVariants || []).map((variant) => [variant.id, variant])).values()];
    const canonicalTitles = products.map((product) => canonicalizeMerchantProductTitle(product.title, product.brand).title).filter(Boolean).sort((a, b) => a.length - b.length);
    const bestPrice = offers.length ? Math.min(...offers.map((offer) => offer.totalPrice)) : base.bestPrice;

    merged.push({
      ...base,
      title: canonicalTitles[0] || base.title,
      normalizedTitle: normalizeText(canonicalTitles[0] || base.title),
      image: products.find((product) => product.image)?.image || base.image,
      familyImage: products.find((product) => product.familyImage)?.familyImage || base.familyImage,
      offers,
      catalogVariants,
      storesCount: new Set(offers.map(merchantKey).filter(Boolean)).size,
      bestPrice,
      dealScore: Math.max(Number(base.dealScore || 0), ...offers.map((offer) => Number(offer.dealScore || 0))),
    });
  }

  return merged;
}
