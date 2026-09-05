# Rebuild validation — 5 September 2026

## Scope and audit

Started from clean `rebuild-v2` commit `5cdaaef`. Audited the active layout, historical styles, search/card/detail components, canonical catalog, API routes, collectors, scripts, tests and deployment configuration before rebuilding. Baseline: 52 passing tests.

Preserved the canonical catalog schema, search, reconciliation, offer persistence, scoring, history, authentication, wishlist, alerts, scheduled collection and deployment configuration. Replaced the homepage, result presentation, filters, detail composition, header/footer and active styling. Replaced the AI query-planning-only response with catalog-backed ranking and comparison. Added a merchant registry and bounded persisted refresh worker.

Removed eleven superseded `app/ceniq*.css` generations after replacing the active import, five historical README snapshots, and the obsolete conventional-feed probe and its package script. No feed was discovered by the previous probe, so repeating guessed feed filenames was not useful.

## Automated verification

- 62 tests pass, including all original tests plus intent parsing/ranking, numeric phone identity, accessory/condition isolation, merchant URL/structured-price parsing and Tavily attempt limits.
- TypeScript: `tsc --noEmit --incremental false` passes.
- Prisma client generation passes.
- Next.js production build passes (36 routes).
- Local commands used the bundled Node executable and the package scripts' underlying entry points because npm was unavailable on PATH. CI runs the normal npm commands.

## Browser verification

Rendered the real application in the browser, including the final production build homepage and login navigation. Checked light/dark theme and mobile navigation. Homepage, search results, product detail and AI comparison were checked at 1440, 1200, 1024, 768 and 390 pixels without horizontal overflow.

Catalog-dependent UI checks used the explicitly synthetic, local-only fixture proxy (`scripts/ui-fixture-server.ts`). Verified brand filtering; variant changes from 128 GB to 256 GB update the displayed price, merchant count and detail URL; product detail variant changes; verdict rendering; and the dedicated two-product AI comparison presentation. Fixture offers use `.invalid` merchant destinations and are never imported by production code or written to the database. These checks prove UI behavior, not live catalog coverage.

## Real endpoint benchmark

The local environment has no configured database. Every real search below returned HTTP 503 with the explicit missing-database error. A dash means unavailable, not zero. Grouping, images and CENIQ scores were also unavailable. Raw responses and parsed AI plans are recorded in `benchmark-results.json`.

| Query | Found | Merchants | Best price | Variants | Detail | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Samsung Galaxy S25 | Unverified | — | — | — | Unverified | HTTP 503; database absent |
| iPhone 16 | Unverified | — | — | — | Unverified | HTTP 503; database absent |
| Honor 400 Lite | Unverified | — | — | — | Unverified | HTTP 503; database absent |
| Sony WH-1000XM5 | Unverified | — | — | — | Unverified | HTTP 503; database absent |
| Lenovo Legion 5 | Unverified | — | — | — | Unverified | HTTP 503; database absent |
| LG OLED C4 | Unverified | — | — | — | Unverified | HTTP 503; database absent |
| Canon EOS R50 | Unverified | — | — | — | Unverified | HTTP 503; database absent |
| Epson EcoTank L3250 | Unverified | — | — | — | Unverified | HTTP 503; database absent |
| MacBook Air M3 16GB 512GB | Unverified | — | — | — | Unverified | HTTP 503; database absent |

All five requested AI prompts were posted to the real endpoint. Category, budget, RAM, OLED/size/refresh-rate, use cases and comparison targets parsed as expected; recommendations could not be fetched without the database. Tests independently validate catalog ranking with controlled data and prevent assigning a cheap variant's price to a different matching variant. Camera quality, gaming performance and editing suitability are identified as things to verify where evidence is absent. The intent parser is deterministic and bounded; it is not a general conversational model. Existing Gemini product verdict support remains.

## Merchant evidence and Tavily

Added URL recognition and structured-product offer validation for Dateks, 1a, AiO, Tet and 220. Existing sitemap/catalog collectors use the registry. Tet also has a verified public search URL. Other merchants rely on discovered product URLs rather than invented internal search routes.

Public Galaxy S25 probes: Dateks, 1a and 220 robots files returned 200 but their product requests returned 403; AiO returned 403; Tet returned 200 and exposed a structured EUR 859 Galaxy S25 12/128 GB Navy offer. No bot restrictions were bypassed. Tet's missing structured SKU falls back to its MPN, preventing unrelated text from becoming an identifier. This is acquisition evidence only: no increase in persisted or searchable merchant counts was verified.

Normal search remains database-only. Product refresh attempts merchant adapters, direct known offer pages and then known-domain Tavily enrichment for weak or stale coverage. Tavily is basic/safe-search, with at most three calls per refresh flow and zero from normal search. A failed Tavily attempt is not retried through the Brave fallback. Candidates must pass merchant URL, structured price, exact-model/accessory/condition and price-sanity gates before `persistCollectedOffers`. The persistence path is implemented but was not exercised against a real database here.

## Remaining environment limits

Live catalog results, authenticated account/wishlist/alert writes, accepted-offer persistence, real price history and Gemini verdict generation require configured services. UI fixture successes do not establish those live integrations. Re-run `scripts/milestone-benchmark.ts` against the configured deployment, and compare Galaxy S25 merchant coverage before and after refresh before claiming coverage improvement. CI and deployment status are reported separately after the final push.
