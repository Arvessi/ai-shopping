# AI Shopping MVP

A first-pass web shell for an AI-first shopping search engine.

## What works now
- Search vs AI Assistant UI switch
- Product query endpoint using mock data
- Demo category grid
- Deal score presentation
- Responsive layout

## Next integration order
1. Product/offer ingestion: Sovrn + Awin/Daisycon feeds.
2. Product identity matching via GTIN/EAN/MPN.
3. Real merchant offers and affiliate URLs.
4. Price-history storage in Postgres.
5. AI requirement parser for natural-language shopping queries.
6. Deal score engine.
7. User accounts + price alerts.
8. Premium limits/subscriptions.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Notes
The current project intentionally uses mock data. No affiliate credentials are included.
