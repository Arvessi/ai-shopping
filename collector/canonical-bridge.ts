import { createHash } from "node:crypto";
import type { NormalizedOfferCandidate } from "../lib/canonical/domain.ts";
import { isRestrictedShoppingQuery } from "../lib/safety.ts";
import type { CollectedOffer } from "./types.ts";

function merchantDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sourceKey(offer: CollectedOffer): string {
  const stable = [offer.merchantSlug, offer.gtin || "", offer.sku || "", offer.url].join("|");
  return createHash("sha256").update(stable).digest("hex").slice(0, 40);
}

function safeCatalogOffer(offer: CollectedOffer) {
  return !isRestrictedShoppingQuery(`${offer.title} ${offer.category || ""} ${offer.url}`);
}

export function collectedOfferToCandidate(offer: CollectedOffer): NormalizedOfferCandidate {
  const key = sourceKey(offer);
  const identifiers: NonNullable<NormalizedOfferCandidate["identifiers"]> = [];
  if (offer.gtin) identifiers.push({ type: "GTIN", value: offer.gtin, source: "collector-v2", confidence: 0.98 });
  if (offer.mpn) identifiers.push({ type: "MPN", value: offer.mpn, source: "collector-v2", confidence: 0.92 });
  identifiers.push({
    type: "SKU_ALIAS",
    value: offer.sku || `page:${key}`,
    source: offer.merchantSlug,
    confidence: offer.sku ? 0.85 : 0.68,
  });

  return {
    source: "collector-v2",
    sourceKey: key,
    merchant: {
      name: offer.merchantName,
      domain: merchantDomain(offer.url),
      slug: offer.merchantSlug,
    },
    title: offer.title,
    brand: offer.brand,
    category: offer.category,
    url: offer.url,
    image: offer.imageUrl
      ? { url: offer.imageUrl, source: offer.merchantSlug, provenance: "offer", confidence: 0.8 }
      : undefined,
    identifiers,
    price: offer.price,
    currency: offer.currency || "EUR",
    availability: offer.availability,
    evidence: {
      explicitOneTime: true,
      displayedPrice: `${offer.price} ${offer.currency || "EUR"}`,
      sellerText: offer.merchantName,
    },
  };
}

export async function persistCollectedOffers(offers: CollectedOffer[]) {
  if (!offers.length) return { examined: 0, accepted: 0, rejected: 0, rejectionReasons: {}, results: [] };

  // Safety is enforced again at the persistence boundary so a permissive/new
  // parser can never bypass catalogue exclusions.
  const safeOffers = offers.filter(safeCatalogOffer);
  const safetyRejected = offers.length - safeOffers.length;
  const rejectionReasons: Record<string, number> = {};
  if (safetyRejected) rejectionReasons["restricted-catalog-category"] = safetyRejected;

  if (!safeOffers.length) {
    return { examined: offers.length, accepted: 0, rejected: offers.length, rejectionReasons, results: [] };
  }

  const { ingestCandidates } = await import("../lib/canonical/catalog.ts");
  const candidates = safeOffers.map(collectedOfferToCandidate);
  const results = await ingestCandidates(candidates);
  const accepted = results.filter((result) => result.accepted).length;
  for (const result of results) {
    if (!result.accepted) {
      const reason = result.reason || "canonical-rejected";
      rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
    }
  }
  return {
    examined: offers.length,
    accepted,
    rejected: offers.length - accepted,
    rejectionReasons,
    results,
  };
}
