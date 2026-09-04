import { createHash } from 'node:crypto';
import { canonicalizeMerchantProductTitle } from './title-normalization.ts';

export type PriceKind = 'ONE_TIME' | 'MONTHLY' | 'DEPOSIT' | 'PLAN' | 'UNKNOWN';
export type ValidationStatus = 'ACCEPTED' | 'QUARANTINED' | 'REJECTED';
export type IdentifierType = 'GTIN' | 'EAN' | 'UPC' | 'MPN' | 'SKU_ALIAS' | 'MODEL_ALIAS';

export type VariantAttributes = Record<string, string | undefined> & {
  storage?: string; ram?: string; color?: string; connectivity?: string;
  cpu?: string; gpu?: string; size?: string; resolution?: string;
  panelType?: string; refreshRate?: string; kit?: string; condition?: string;
};

export type IdentifierCandidate = { type: IdentifierType; value: string; source?: string; confidence?: number };
export type ImageCandidate = { url: string; source: string; provenance: 'variant' | 'offer' | 'family'; confidence: number };

export type NormalizedOfferCandidate = {
  source: string;
  sourceKey: string;
  merchant: { name: string; domain: string; slug?: string };
  title: string;
  brand?: string;
  model?: string;
  category?: string;
  description?: string;
  url: string;
  image?: ImageCandidate;
  identifiers?: IdentifierCandidate[];
  attributes?: VariantAttributes;
  price: number;
  shippingPrice?: number;
  currency?: string;
  availability?: string;
  stockQty?: number;
  evidence?: {
    displayedPrice?: string;
    sellerText?: string;
    tags?: string[];
    surroundingText?: string;
    priceMultiplier?: number;
    explicitOneTime?: boolean;
  };
};

export type ResolvedCandidate = NormalizedOfferCandidate & {
  familyKey: string;
  familyTitle: string;
  normalizedTitle: string;
  attributes: VariantAttributes;
  variantKey: string;
  priceKind: PriceKind;
  validationStatus: ValidationStatus;
  rejectionReason?: string;
  totalPrice?: number;
  confidence: number;
};

const NON_MERCHANT_DOMAINS = new Set([
  'gsmarena.com', 'notebookcheck.net', 'rtings.com', 'youtube.com',
  'facebook.com', 'instagram.com', 'google.com', 'shopping.google.com',
]);

export function merchantDomainAllowed(domain: string, approvedDomains: Iterable<string>) {
  const normalized = domain.toLowerCase().replace(/^www\./, '').split(':')[0];
  if (!normalized || NON_MERCHANT_DOMAINS.has(normalized)) return false;
  return Array.from(approvedDomains).some((approved) => {
    const value = approved.toLowerCase().replace(/^www\./, '');
    return normalized === value || normalized.endsWith(`.${value}`);
  });
}

const RECURRING = /(?:\/\s*(?:month|mo\b|men)|per\s+month|monthly|menesi|menesim|nomaks|lizing|leasing|installment|instalment|subscription|abone|\b(?:[2-9]|[1-5]\d|60)\s+[x×]\s*(?:€|eur|\$)?\s*\d+)/i;
const DEPOSIT = /(?:first\s+payment|down\s+payment|deposit|pirm[aa]\s+iemaksa|s[aa]kotn[eē]j[aa]\s+iemaksa)/i;
const PLAN = /(?:tariff|tarifs?|device\s+plan|with\s+(?:a\s+)?plan|conditional\s+on\s+subscription)/i;
const USED = /\b(?:used|refurbished|renewed|reconditioned|open[\s-]?box|demo|lietots|lietota|atjaunots|atjaunota|vitrinas)\b/i;
const ACCESSORY = /\b(?:case|cover|screen protector|glass|charger|adapter|cable|macins|vacins|aizsargstikls)\b/i;
const COLOR_RULES: Array<[RegExp, string]> = [
  [/\b(?:black|midnight|obsidian|graphite|melns|melna)\b/i, 'Black'],
  [/\b(?:white|starlight|porcelain|balts|balta)\b/i, 'White'],
  [/\b(?:navy|blue|ultramarine|zils|zila)\b/i, 'Blue'],
  [/\b(?:green|mint|teal|zals|zala)\b/i, 'Green'],
  [/\b(?:gray|grey|silver|peleks|peleka|sudraba)\b/i, 'Gray'],
  [/\b(?:pink|rose|roza)\b/i, 'Pink'],
  [/\b(?:red|sarkans|sarkana)\b/i, 'Red'],
  [/\b(?:purple|violet|violets|violeta)\b/i, 'Purple'],
  [/\b(?:gold|zelta)\b/i, 'Gold'],
];

export function normalizeText(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function firstMatch(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1]?.replace(/\s+/g, ' ').trim();
}

export function extractAttributes(title: string, supplied: VariantAttributes = {}): VariantAttributes {
  const storageTb = firstMatch(title, /\b(\d+(?:[.,]\d+)?)\s*TB\b/i);
  const storageGb = Array.from(title.matchAll(/\b(64|128|256|512|1024|2048)\s*GB\b/gi)).map((match) => Number(match[1])).sort((a, b) => b - a)[0];
  const ram = firstMatch(title, /\b(\d{1,3})\s*GB\s*(?:RAM|memory|operativ)/i);
  const cpu = firstMatch(title, /\b((?:Intel\s+)?Core\s+Ultra\s+[3579]\s+\d{3}[A-Z]*|(?:Intel\s+)?Core\s+i[3579][\s-]?\d{4,5}[A-Z]*|(?:AMD\s+)?Ryzen\s+[3579]\s+\d{4}[A-Z]*)\b/i);
  const gpu = firstMatch(title, /\b((?:GeForce\s+)?(?:RTX|GTX)\s*\d{3,4}\s*(?:Ti|Super)?|Radeon\s+RX\s*\d{4}\s*(?:XT)?)\b/i);
  const size = firstMatch(title, /\b(\d{1,3}(?:[.,]\d)?)\s*(?:inch(?:es)?|\")/i);
  const resolution = firstMatch(title, /\b(8K|5K|4K|QHD|WQHD|UHD|FHD|Full\s*HD|\d{3,4}\s*[x×]\s*\d{3,4})\b/i);
  const refreshRate = firstMatch(title, /\b(\d{2,3})\s*Hz\b/i);
  const panelType = firstMatch(title, /\b(OLED|QD-OLED|Mini\s*LED|IPS|VA|TN)\b/i);
  const kit = /\b(?:body\s*\+|lens\s+kit|kit\b|\d{1,3}\s*-\s*\d{1,3}\s*mm)/i.test(title)
    ? firstMatch(title, /\b(body\s*\+[^,;]*|(?:RF|EF|E|Z|XF|MFT)[-\s]?S?\s*\d{1,3}\s*-\s*\d{1,3}\s*mm[^,;]*)/i) || 'Kit'
    : undefined;
  const color = COLOR_RULES.find(([pattern]) => pattern.test(title))?.[1];

  return compactAttributes({
    storage: supplied.storage || (storageTb ? `${storageTb.replace(',', '.')}TB` : storageGb ? `${storageGb}GB` : undefined),
    ram: supplied.ram || (ram ? `${ram}GB` : undefined), color: supplied.color || color,
    connectivity: supplied.connectivity || (/\b5G\b/i.test(title) ? '5G' : /\bLTE\b/i.test(title) ? 'LTE' : undefined),
    cpu: supplied.cpu || cpu, gpu: supplied.gpu || gpu,
    size: supplied.size || (size ? `${size.replace(',', '.')} inch` : undefined),
    resolution: supplied.resolution || resolution?.toUpperCase(), panelType: supplied.panelType || panelType?.toUpperCase(),
    refreshRate: supplied.refreshRate || (refreshRate ? `${refreshRate}Hz` : undefined), kit: supplied.kit || kit,
    condition: supplied.condition || (USED.test(title) ? 'Refurbished / Used' : 'New'),
  });
}

export function compactAttributes(attributes: VariantAttributes): VariantAttributes {
  return Object.fromEntries(Object.entries(attributes).filter(([, value]) => Boolean(value))) as VariantAttributes;
}

function stripAttributes(title: string, attributes: VariantAttributes, identifiers: IdentifierCandidate[]) {
  let value = title;
  for (const attribute of Object.values(attributes)) {
    if (!attribute || attribute === 'New') continue;
    const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    value = value.replace(new RegExp(escaped, 'gi'), ' ');
  }
  for (const identifier of identifiers.filter((item) => item.type === 'MPN' || item.type === 'SKU_ALIAS')) {
    const escaped = identifier.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    value = value.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), ' ');
  }
  return value
    .replace(/\b(?:smartphone|mobile phone|mobilais telefons|viedtalrunis|laptop|notebook|portativais dators|television|televizors|monitor)\b/gi, ' ')
    .replace(/\b(?:SSD|HDD|RAM|memory|GeForce|Radeon)\b/gi, ' ')
    .replace(/\b(?:R[3579]|i[3579])[-\s]?\d{4,5}[A-Z]*\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:GB|TB|Hz|inch(?:es)?)\b/gi, ' ')
    .replace(/\s*[,;|]+\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

export function classifyPrice(candidate: NormalizedOfferCandidate): { kind: PriceKind; reason?: string } {
  if (!Number.isFinite(candidate.price) || candidate.price <= 0) return { kind: 'UNKNOWN', reason: 'non-positive-price' };
  const evidence = [candidate.title, candidate.description, candidate.evidence?.displayedPrice, candidate.evidence?.sellerText,
    ...(candidate.evidence?.tags || []), candidate.evidence?.surroundingText].filter(Boolean).join(' ');
  if (DEPOSIT.test(evidence)) return { kind: 'DEPOSIT', reason: 'deposit-language' };
  if (PLAN.test(evidence)) return { kind: 'PLAN', reason: 'plan-language' };
  if ((candidate.evidence?.priceMultiplier || 1) > 1 || RECURRING.test(evidence)) return { kind: 'MONTHLY', reason: 'recurring-language-or-multiplier' };
  if (candidate.evidence?.explicitOneTime === false) return { kind: 'UNKNOWN', reason: 'one-time-price-not-confirmed' };
  return { kind: 'ONE_TIME' };
}

export function normalizeAvailability(value?: string) {
  const normalized = normalizeText(value || '');
  if (!normalized) return undefined;
  if (/(out of stock|sold out|nav pieej|izpardots|unavailable)/.test(normalized)) return 'out_of_stock';
  if (/(preorder|pre order|iepriekspasut)/.test(normalized)) return 'preorder';
  if (/(in stock|available|ir pieej|noliktava|ships)/.test(normalized)) return 'in_stock';
  return 'unknown';
}

export function resolveCandidate(candidate: NormalizedOfferCandidate): ResolvedCandidate {
  const identifiers = candidate.identifiers || [];
  const attributes = extractAttributes(candidate.title, candidate.attributes);
  const stripped = stripAttributes(candidate.title, attributes, identifiers);
  const brandLabel = candidate.brand?.trim();
  const withoutBrand = brandLabel
    ? stripped.replace(new RegExp(`\\b${brandLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ').replace(/\s+/g, ' ').trim()
    : stripped;
  const canonical = canonicalizeMerchantProductTitle(withoutBrand || stripped || candidate.title, brandLabel);
  const familyTitle = canonical.title;
  const normalizedTitle = normalizeText(familyTitle);
  const brand = normalizeText(candidate.brand || '').replace(/\s/g, '');
  const accessory = ACCESSORY.test(candidate.title) ? 'accessory:' : '';
  const familyKey = `${accessory}${brand ? `${brand}:` : ''}${normalizedTitle}`;
  const identity = identifiers.find((item) => ['GTIN', 'EAN', 'UPC'].includes(item.type))
    || identifiers.find((item) => item.type === 'MPN')
    || identifiers.find((item) => item.type === 'MODEL_ALIAS');
  const merchantLocalIdentity = identifiers.find((item) => item.type === 'SKU_ALIAS');
  const attrSignature = Object.entries(attributes).filter(([key, value]) => value && !(key === 'condition' && value === 'New'))
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}:${normalizeText(String(value))}`).join('|');
  const variantKey = identity
    ? `${identity.type.toLowerCase()}:${normalizeText(identity.value).replace(/\s/g, '')}`
    : `attrs:${hash(`${familyKey}|${attrSignature || normalizeText(candidate.title)}`)}`;
  const price = classifyPrice(candidate);
  const accepted = price.kind === 'ONE_TIME';
  const totalPrice = accepted ? candidate.price + Math.max(0, candidate.shippingPrice || 0) : undefined;
  const confidence = identity
    ? Math.max(0.7, identity.confidence || 0.8)
    : attrSignature
      ? Math.max(0.65, merchantLocalIdentity?.confidence || 0)
      : merchantLocalIdentity
        ? Math.max(0.62, merchantLocalIdentity.confidence || 0)
        : 0.4;

  return {
    ...candidate, availability: normalizeAvailability(candidate.availability), brand: candidate.brand, identifiers, attributes, familyKey, familyTitle,
    normalizedTitle, variantKey, priceKind: price.kind,
    validationStatus: accepted ? (confidence >= 0.6 ? 'ACCEPTED' : 'QUARANTINED') : 'REJECTED',
    rejectionReason: accepted ? (confidence < 0.6 ? 'low-identity-confidence' : undefined) : price.reason,
    totalPrice, confidence,
  };
}

export function applyVariantOutlierValidation(candidates: ResolvedCandidate[]) {
  const groups = new Map<string, ResolvedCandidate[]>();
  for (const candidate of candidates) groups.set(candidate.variantKey, [...(groups.get(candidate.variantKey) || []), candidate]);
  return candidates.map((candidate) => {
    if (candidate.validationStatus !== 'ACCEPTED' || !candidate.totalPrice) return candidate;
    const peers = (groups.get(candidate.variantKey) || []).filter((item) => item.validationStatus === 'ACCEPTED' && item.totalPrice).map((item) => item.totalPrice!).sort((a, b) => a - b);
    if (peers.length < 3) return candidate;
    const mid = Math.floor(peers.length / 2);
    const median = peers.length % 2 ? peers[mid] : (peers[mid - 1] + peers[mid]) / 2;
    return median >= 100 && candidate.totalPrice < median * 0.38
      ? { ...candidate, validationStatus: 'QUARANTINED' as const, rejectionReason: 'extreme-low-outlier' }
      : candidate;
  });
}

export function scoreExactVariant<T extends { merchantKey: string; totalPrice: number; trust?: number; available?: boolean; confidence?: number; fresh?: boolean }>(offers: T[]) {
  const merchants = new Set(offers.map((offer) => offer.merchantKey));
  const prices = offers.map((offer) => offer.totalPrice).sort((a, b) => a - b);
  if (merchants.size < 2 || !prices.length) return offers.map((offer) => ({ ...offer, score: 0 }));
  const mid = Math.floor(prices.length / 2);
  const reference = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  return offers.map((offer) => {
    const relative = (reference - offer.totalPrice) / reference;
    const priceComponent = Math.max(-12, Math.min(12, relative * 120));
    const trust = offer.trust == null ? 0 : Math.max(-2, Math.min(2, (offer.trust - 4) * 2));
    const availability = offer.available === false ? -3 : offer.available ? 1 : 0;
    const freshness = offer.fresh === false ? -3 : 1;
    const confidence = Math.max(-2, Math.min(1, ((offer.confidence ?? 0.7) - 0.7) * 5));
    return { ...offer, score: Math.round(Math.max(60, Math.min(94, 82 + priceComponent + trust + availability + freshness + confidence))) };
  });
}

export function chooseImage(images: ImageCandidate[], familyFallback?: string) {
  const ranked = [...images].filter((image) => /^https?:\/\//i.test(image.url)).sort((a, b) => {
    const priority = { variant: 3, offer: 2, family: 1 } as const;
    return priority[b.provenance] - priority[a.provenance] || b.confidence - a.confidence;
  });
  return ranked[0]?.url || familyFallback;
}

export function validVariantSelections<T extends { id: string; attributes: VariantAttributes }>(variants: T[], selected: VariantAttributes) {
  return variants.filter((variant) => Object.entries(selected).every(([key, value]) => !value || variant.attributes[key] === value));
}

export function selectVariantForQuery<T extends { attributes: VariantAttributes; bestPrice?: number; offerCount?: number }>(variants: T[], query: string) {
  const wanted = normalizeText(query);
  const ranked = variants.map((variant, index) => ({
    variant, index,
    matches: Object.values(variant.attributes).filter((value) => value && value !== 'New' && wanted.includes(normalizeText(value))).length,
  }));
  const bestMatch = Math.max(0, ...ranked.map((item) => item.matches));
  return ranked
    .filter((item) => bestMatch > 0 ? item.matches === bestMatch : (item.variant.offerCount ?? 1) > 0)
    .sort((a, b) => (a.variant.bestPrice ?? Number.POSITIVE_INFINITY) - (b.variant.bestPrice ?? Number.POSITIVE_INFINITY) || a.index - b.index)[0]?.variant;
}

export type ProviderTaskState = { state: 'pending' | 'succeeded' | 'failed'; error?: string };
export function providerTaskState(task: { status_code?: number; status_message?: string; result?: unknown }): ProviderTaskState {
  if (
    task.status_code === 40401 ||
    task.status_code === 40601 ||
    task.status_code === 40602
  ) {
    return { state: 'pending' };
  }

  if (typeof task.status_code === 'number' && task.status_code >= 40000) {
    return {
      state: 'failed',
      error: task.status_message || `Provider error ${task.status_code}`,
    };
  }

  if (Array.isArray(task.result)) {
    return { state: 'succeeded' };
  }

  return {
    state: 'failed',
    error: task.status_message || 'Provider returned no result',
  };
}

export function enrichmentLimitState(input: { deadlineAt: Date; attempts: number; maxAttempts: number; now?: Date }) {
  const now = input.now || new Date();
  if (input.deadlineAt <= now) return { allowed: false, reason: 'deadline' as const };
  if (input.attempts >= input.maxAttempts) return { allowed: false, reason: 'attempts' as const };
  return { allowed: true as const };
}
