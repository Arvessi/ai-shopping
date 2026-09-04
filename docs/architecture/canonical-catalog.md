# Canonical catalog architecture

## Decision

`ProductFamily -> ProductVariant -> MerchantOffer -> OfferObservation` is the only active shopping read model. `VariantIdentifier` supplies durable identity and `VariantImage` supplies image provenance. DataForSEO is an enrichment source, never a product database.

The request path is:

1. `/api/search` normalizes and checks the safety policy.
2. It queries indexed canonical families and returns their real variants and fresh, accepted `ONE_TIME` offers immediately.
3. If coverage is weak it creates/reuses an `EnrichmentJob` and returns its token without calling a crawler or remote shopping API.
4. `/api/merchant/enrich` starts or advances the durable job. DataForSEO results become `NormalizedOfferCandidate` records and pass through the shared identity, variant, price, merchant, image, confidence, and persistence pipeline.
5. Search and product detail read the same family, variant IDs, offers, score, images, and observations.

Every future feed, API, affiliate feed, or store adapter must emit `NormalizedOfferCandidate` and call `ingestCandidates`. Source-specific grouping, scoring, or direct writes to product/offer tables are forbidden.

## Identity and variants

Identity priority is GTIN/EAN/UPC, then MPN, model/SKU aliases, normalized attributes, and finally a low-confidence normalized-title fallback. Low-confidence candidates are quarantined. Family tokens preserve model qualifiers and accessory separation. Variants store explicit extensible attributes; the API returns the valid variant matrix, so the UI selects an existing variant ID rather than combining independent axes.

## Prices and score

All source evidence is classified as `ONE_TIME`, `MONTHLY`, `DEPOSIT`, `PLAN`, or `UNKNOWN`. Only fresh, accepted `ONE_TIME` rows can appear. An update replaces the current observation even when the new number is higher; invalid observations clear the comparable price instead of leaving a lower stale value.

Scores are computed only inside one exact variant with at least two merchants. The reference is the median total price. Price contribution is bounded to +/-12 points; merchant trust to +/-2, availability to -3/+1, freshness to -3/+1, and confidence to -2/+1. The final range is 60-94, preventing close prices from producing a cliff.

## Jobs and caching

Enrichment state lives in `EnrichmentJob`, not `SearchCache`. Documented provider pending codes are the only pending states. Jobs have an absolute deadline, a maximum poll count, terminal errors, and client backoff. Canonical rows are the durable cache; freshness is represented by `lastSeenAt`/`expiresAt`. Serialized v3.5 search-result caches are not read by active search.

## Images

Images remain attached to exact variants with source, provenance, confidence, and verification time. Selection precedence is trusted exact-variant image, exact-offer image, family fallback, then placeholder. A seller image cannot overwrite all variants.

## Migration and compatibility

Legacy `Product`/`Offer` tables remain temporarily for old URLs and unmigrated references. `ProductAlias`, nullable legacy keys, and canonical family/variant/offer keys preserve URLs, wishlist, alerts, and affiliate clicks. Existing experimental catalog prices are quarantined until revalidated.

## Retired active paths

- `lib/merchant-engine.ts` (v3.5 alternate grouping/persistence)
- `lib/store-adapters.ts` (v3.4 direct catalog writes)
- `lib/crawler.ts` (v3.3 query-time/direct-write crawler)
- `lib/catalog.ts` compatibility projection as a search source
- `lib/dataforseo.ts` and `lib/merchant-api.ts` as runtime clients
- `lib/products.ts` destructive `replaceOffers` path
- search/enrichment tasks in `SearchCache`
- crawler, adapter, market, import, and duplicate status API endpoints

The source files are retained only for migration forensics. Their endpoints return HTTP 410 and no active route imports them. Delete them and the legacy tables only after production aliases and user-reference counts are verified.
