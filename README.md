# CENIQ

Latvian-first price comparison and catalogue-backed product search built with Next.js, TypeScript, PostgreSQL, and Prisma.

## Runtime architecture

Normal user search reads only CENIQ's canonical `ProductFamily` / `ProductVariant` / `MerchantOffer` catalogue. It never calls Tavily or DataForSEO. Catalogue population is a separate scheduled workflow:

1. public merchant feed/API when configured;
2. public sitemap discovery;
3. public category/listing adapter;
4. optional, explicitly invoked discovery fallback.

The collector normalizes global and merchant-scoped identity, separates real variants, excludes restricted products, rejects recurring prices, and expires stale offers from search.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local`.
3. Set `DATABASE_URL`, `AUTH_SECRET`, and `CRON_SECRET`.
4. Run `npx prisma migrate deploy` (or `npm run db:push` for a disposable local database).
5. Run `npm run dev`.

AI planning works locally without a provider key and searches the same CENIQ catalogue. `GEMINI_API_KEY` is optional for richer natural-language planning. DataForSEO credentials are optional legacy/discovery compatibility only.

## Catalogue sync

Run the daily multi-store job locally with:

```sh
curl "http://localhost:3000/api/cron/catalog-batch?stores=euronics,m79,bite,lmt,tele2,rd&limit=40"
```

In production, send `Authorization: Bearer $CRON_SECRET`. The response includes store, discovery, parsing, persistence, rejection, duration, merchant, and Tavily metrics. `cursor=N` selects a deterministic incremental slice; otherwise the slice rotates daily.

For a database-free live parser smoke test:

```sh
node --experimental-strip-types scripts/collector-bulk-smoke.ts "euronics,m79,bite,lmt,tele2,rd" 20 0
```

## Verification

```sh
npm test
npm run typecheck
npm run build
```

Automatic Vercel deployments for `rebuild-v2` remain disabled in `vercel.json`.
