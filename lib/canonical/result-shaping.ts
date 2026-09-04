import type { ProductResult, VariantAttributes } from '@/lib/types';
import { normalizeText } from './domain';
import { canonicalizeMerchantProductTitle } from './title-normalization';

const PHONE_ALLOWED_AXES = new Set(['storage', 'ram', 'color', 'connectivity', 'condition']);
const IPHONE_ALLOWED_AXES = new Set(['storage', 'color', 'connectivity', 'condition']);

function isSpecificPhoneModel(value: string) {
  return /\biphone\s+\d{1,2}\b/i.test(value) || /\bgalaxy\s+[a-z]\d{1,3}\b/i.test(value);
}

function canonicalTitle(value: string) {
  return canonicalizeMerchantProductTitle(value).title;
}

function isPhoneFamily(title: string) {
  return /\biphone\b/i.test(title) || /\bgalaxy\s+[a-z]\d/i.test(title);
}

function allowedAxesFor(title: string) {
  if (/\biphone\b/i.test(title)) return IPHONE_ALLOWED_AXES;
  if (isPhoneFamily(title)) return PHONE_ALLOWED_AXES;
  return null;
}

export function sanitizeVariantAttributes(title: string, attributes: VariantAttributes = {}): VariantAttributes {
  const allowed = allowedAxesFor(title);
  if (!allowed) return Object.fromEntries(Object.entries(attributes).filter(([, value]) => Boolean(value))) as VariantAttributes;
  return Object.fromEntries(
    Object.entries(attributes).filter(([key, value]) => Boolean(value) && allowed.has(key)),
  ) as VariantAttributes;
}

function variantSignature(attributes: VariantAttributes) {
  return Object.entries(attributes)
    .filter(([key, value]) => value && !(key === 'condition' && value === 'New'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${normalizeText(String(value))}`)
    .join('|') || 'default';
}

function exactIntentMatches(productTitle: string, query: string) {
  if (!isSpecificPhoneModel(query)) return true;
  return normalizeText(canonicalTitle(productTitle)) === normalizeText(canonicalTitle(query));
}

export function shapeCanonicalResults(
  input: ProductResult[],
  query: string,
  preferredVariantId?: string,
): ProductResult[] {
  const filtered = input.filter((product) => exactIntentMatches(product.title, query));
  const groups = new Map<string, ProductResult[]>();

  for (const product of filtered) {
    const title = canonicalTitle(product.title);
    const key = normalizeText(title);
    groups.set(key, [...(groups.get(key) || []), { ...product, title, normalizedTitle: key }]);
  }

  const output: ProductResult[] = [];

  for (const products of groups.values()) {
    const title = products[0].title;
    const brand = products.find((product) => product.brand)?.brand;
    const category = products.find((product) => product.category)?.category;

    const signatureToIds = new Map<string, string[]>();
    const signatureToAttributes = new Map<string, VariantAttributes>();
    const signatureToImage = new Map<string, string>();
    const signatureToPrices = new Map<string, number[]>();

    for (const product of products) {
      for (const variant of product.catalogVariants || []) {
        if ((variant.offerCount || 0) <= 0) continue;
        const attrs = sanitizeVariantAttributes(title, variant.attributes || {});
        const signature = variantSignature(attrs);
        signatureToIds.set(signature, [...(signatureToIds.get(signature) || []), variant.id]);
        signatureToAttributes.set(signature, attrs);
        if (variant.image && !signatureToImage.has(signature)) signatureToImage.set(signature, variant.image);
        if (variant.bestPrice != null) {
          signatureToPrices.set(signature, [...(signatureToPrices.get(signature) || []), variant.bestPrice]);
        }
      }

      for (const offer of product.offers || []) {
        const attrs = sanitizeVariantAttributes(title, offer.variantData || {});
        const signature = variantSignature(attrs);
        if (offer.variantId) {
          signatureToIds.set(signature, [...(signatureToIds.get(signature) || []), offer.variantId]);
        }
        signatureToAttributes.set(signature, attrs);
        if (offer.image && !signatureToImage.has(signature)) signatureToImage.set(signature, offer.image);
        signatureToPrices.set(signature, [...(signatureToPrices.get(signature) || []), offer.totalPrice]);
      }
    }

    const representativeId = new Map<string, string>();
    for (const [signature, ids] of signatureToIds) {
      if (!ids.length) continue;
      representativeId.set(
        signature,
        preferredVariantId && ids.includes(preferredVariantId) ? preferredVariantId : ids[0],
      );
    }

    const offersByKey = new Map<string, any>();
    for (const product of products) {
      for (const offer of product.offers || []) {
        const attrs = sanitizeVariantAttributes(title, offer.variantData || {});
        const signature = variantSignature(attrs);
        const mappedVariantId = representativeId.get(signature) || offer.variantId;
        if (!mappedVariantId) continue;
        const merchant = normalizeText(String(offer.merchantDomain || offer.merchant || ''));
        const key = `${merchant}|${signature}|${normalizeText(String(offer.url || ''))}`;
        const shaped = {
          ...offer,
          variantId: mappedVariantId,
          variantData: attrs,
          variantLabel: Object.values(attrs).filter((value) => value && value !== 'New').join(' · '),
        };
        const existing = offersByKey.get(key);
        if (!existing || shaped.totalPrice < existing.totalPrice) offersByKey.set(key, shaped);
      }
    }

    const offers = Array.from(offersByKey.values()).sort((a, b) => a.totalPrice - b.totalPrice);
    const catalogVariants = Array.from(signatureToAttributes.entries()).flatMap(([signature, attributes]) => {
      const id = representativeId.get(signature);
      if (!id) return [];
      const prices = signatureToPrices.get(signature) || [];
      return [{
        id,
        variantKey: `display:${signature}`,
        attributes,
        image: signatureToImage.get(signature),
        offerCount: new Set(offers.filter((offer) => offer.variantId === id).map((offer) => offer.merchantDomain || offer.merchant)).size,
        bestPrice: prices.length ? Math.min(...prices) : undefined,
      }];
    }).filter((variant) => variant.offerCount > 0);

    if (!offers.length || !catalogVariants.length) continue;

    const selectedFromPreference = catalogVariants.find((variant) => variant.id === preferredVariantId);
    const cheapestOffer = offers[0];
    const selectedVariantId = selectedFromPreference?.id || cheapestOffer.variantId || catalogVariants[0].id;
    const selectedOffers = offers.filter((offer) => offer.variantId === selectedVariantId);
    const familyImage =
      products.find((product) => product.familyImage)?.familyImage ||
      catalogVariants.find((variant) => variant.id === selectedVariantId)?.image ||
      catalogVariants.find((variant) => variant.image)?.image ||
      offers.find((offer) => offer.image)?.image ||
      products.find((product) => product.image)?.image;

    const primary = [...products].sort((a, b) => (b.offers?.length || 0) - (a.offers?.length || 0))[0];
    output.push({
      ...primary,
      title,
      normalizedTitle: normalizeText(title),
      brand,
      category,
      image: catalogVariants.find((variant) => variant.id === selectedVariantId)?.image || familyImage,
      familyImage,
      offers,
      catalogVariants,
      variants: catalogVariants.map((variant) => Object.values(variant.attributes).filter((value) => value && value !== 'New').join(' · ')),
      selectedVariantId,
      bestPrice: selectedOffers.length ? Math.min(...selectedOffers.map((offer) => offer.totalPrice)) : Math.min(...offers.map((offer) => offer.totalPrice)),
      currency: selectedOffers[0]?.currency || offers[0]?.currency || 'EUR',
      storesCount: new Set(selectedOffers.map((offer) => offer.merchantDomain || offer.merchant)).size,
      dealScore: Math.max(0, ...selectedOffers.map((offer) => Number(offer.dealScore || 0))),
    });
  }

  return output.sort((a, b) => {
    const exactA = normalizeText(a.title) === normalizeText(canonicalTitle(query)) ? 1 : 0;
    const exactB = normalizeText(b.title) === normalizeText(canonicalTitle(query)) ? 1 : 0;
    return exactB - exactA || (b.storesCount || 0) - (a.storesCount || 0) || a.bestPrice - b.bestPrice;
  });
}
