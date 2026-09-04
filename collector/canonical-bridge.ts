import { createHash } from "node:crypto";
import type { NormalizedOfferCandidate } from "../lib/canonical/domain.ts";
import type { CollectedOffer } from "./types.ts";

function merchantDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sourceKey(offer: CollectedOffer): string {
  const stable = [
    offer.merchantSlug,
    offer.gtin || "",
    offer.sku || "",
    offer.url,
  ].join("|");
  return createHash("sha256").update(stable).digest("hex").slice(0, 40);
}

export function collectedOfferToCandidate(offer: CollectedOffer): NormalizedOfferCandidate {
  const identifiers: NonNullable<NormalizedOfferCandidate["identifiers"]> = [];
  if (offer.gtin) identifiers.push({ type: "GTIN", value: offer.gtin, source: "collector-v2", confidence: 0.98 });
  if (offer.sku) identifiers.push({ type: "SKU_ALIAS", value: offer.sku, source: offer.merchantSlug, confidence: 0.85 });

  return {
    source: "collector-v2",
    sourceKey: sourceKey(offer),
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
      ? {
          url: offer.imageUrl,
          source: offer.merchantSlug,
          provenance: "offer",
          confidence: 0.8,
        }
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
  if (!offers.length) return { examined: 0, accepted: 0, rejected: 0, results: [] };
  const { ingestCandidates } = await import("../lib/canonical/catalog.ts");
  const candidates = offers.map(collectedOfferToCandidate);
  const results = await ingestCandidates(candidates);
  const accepted = results.filter((result) => result.accepted).length;
  return {
    examined: offers.length,
    accepted,
    rejected: offers.length - accepted,
    results,
  };
}
