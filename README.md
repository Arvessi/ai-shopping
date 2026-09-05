# CENIQ

Latvia-first product discovery, price comparison and a catalog-backed shopping assistant. Built with Next.js 16, React 19, TypeScript, PostgreSQL and Prisma.

## Architecture

- Normal `/api/search` requests read the internal `ProductFamily` → `ProductVariant` → `MerchantOffer` catalog only. They make no discovery-provider calls.
- The homepage, merchant comparison stream, product analysis, account pages and light/dark themes share **one stylesheet**, `app/globals.css`.
- `/api/ai` parses shopping intent and searches the catalog. It ranks actual variants against budget and known attributes, returns exact variant links, and labels unknown requirements. Two named comparison targets are searched separately. It never generates prices, stock, specifications or merchant counts. Camera quality and use-case suitability are explicitly unverified when evidence is missing.
- Product analysis preserves merchant offers, variant selection, wishlist, price history, price alerts and the optional Gemini verdict endpoint.
- Scheduled collectors populate the catalog independently of interactive search. Existing canonical identity, safety and outlier validation remain the persistence gate.

## Local setup

Use Node 24 LTS (the scripts use native TypeScript stripping).

```sh
npm install
# Copy .env.example to .env.local and supply credentials.
npm run db:generate
npm run db:migrate
npm run dev
```

`db:migrate` applies committed migrations; `db:push` is for a disposable development database. Do not point development scripts at a database you do not intend to modify.

Required environment variables: `DATABASE_URL` (PostgreSQL), `AUTH_SECRET` (sessions), and `CRON_SECRET` (scheduled operations). Configure `NEXT_PUBLIC_APP_URL` for deployment. The complete environment reference is `.env.example`.

Optional: `TAVILY_API_KEY` for bounded discovery; `BRAVE_SEARCH_API_KEY` for existing discovery fallback; `GEMINI_API_KEY`/`GEMINI_MODEL` for product verdicts. DataForSEO credentials support legacy enrichment jobs. Email and browser-push settings in `.env.example` enable alert delivery.

Without a database, normal search and AI return an explicit 503 configuration error. This is not a populated demo catalog.

## Catalog operations

```sh
npm run catalog:bootstrap
npm run catalog:coverage
npm run catalog:coverage:tavily
npm run catalog:finalize
```

Bootstrap and coverage commands write catalog data. `catalog:finalize` executes the three commands above in sequence. `catalog:sync` supports custom store lists and bounded slices. Vercel cron routes are declared in `vercel.json`; production cron calls require `Authorization: Bearer $CRON_SECRET`.

## Merchant adapters

`collector/merchant-adapters.ts` is the registry for Dateks, 1a, AiO, Tet and 220 public product-page recognition and structured parsing. Tet also has a verified public search URL. Other merchants retain existing collectors and public sitemap/category discovery. Catalog listing and sitemap collectors use the registry. Merchant-specific parsers require structured product prices and reject unrelated URL shapes.

A registry entry does **not** mean live acquisition works. The September 5, 2026 probe parsed Tet's Galaxy S25 page; Dateks, 1a, AiO and 220 returned HTTP 403 to the collector. No authentication, CAPTCHA or anti-bot bypass is implemented. Run `npm run collector:merchant-evidence` for the bounded public-page diagnostic. Its raw output is stored only under ignored `.next/merchant-evidence`.

Conventional feed guessing previously found no feeds. The obsolete generic feed-probe command is removed; no acquisition flow guesses feed filenames.

## Product refresh and Tavily

`POST /api/products/:id/refresh` claims an enrichment job and runs merchant acquisition with Next.js `after`. It tries configured merchant search/category pages, known direct offer URLs, then optional discovery when coverage is below three merchants or offers are stale. Successful refreshes have a one-hour cooldown. The client polls, reloads the product, and reports errors.

Tavily uses basic depth, safe search, exact model queries and known merchant domain clusters. Normal search makes **zero** calls. Refresh makes at most **three** Tavily calls; the standalone coverage script also has a global three-call cap. A failed Tavily request is not retried through a provider-fallback loop.

Candidates must be fetched as product pages, parsed, match the model and condition, exclude accessory mismatches, pass a price-sanity gate and then pass existing canonical validation before persistence. Discovery text is never treated as a priced offer. `persistCollectedOffers` performs persistence; live DB persistence must be verified in the configured deployment. Console diagnostics distinguish parsed/accepted offers from before/after merchant counts.

## Validation and CI

```sh
npm test
npm run typecheck
npm run build
```

The GitHub Actions workflow runs tests, TypeScript and the production build. Vercel deployments are **enabled for `rebuild-v2`**. Keep work on that branch; do not merge it into `main` as part of this milestone. Apply database migrations before using a deployment with a new schema.

For reproducible UI checks without a database, run `npm run dev` plus `npm run test:ui:fixtures`, then open `http://127.0.0.1:3001`. This local-only proxy serves explicitly synthetic API data and forwards the real application assets. It is not used by production routes or collectors, and cannot validate live prices or persistence.

See `docs/validation.md` for the actual checks and remaining deployment limitations for this milestone.
