# CENIQ

Latvian-first price comparison + AI shopping assistant built with Next.js, TypeScript, PostgreSQL/Prisma, DataForSEO Merchant API and the OpenAI Responses API.

## Included
- Latvian homepage with Search / Ceniq AI modes
- DataForSEO Google Shopping product search and polling
- Product grouping by Google Shopping product identity
- Seller/offer refresh on the product page
- Ceniq score: total price + delivery + seller/relevance signals
- PostgreSQL product, offer and price-history persistence
- Product detail pages and price-history chart
- Email/password accounts with HTTP-only JWT session cookie
- Wishlist and price alerts
- Browser push subscriptions + service worker
- Email alerts through Resend HTTPS API
- Daily Vercel Cron route (Hobby-compatible cadence)
- Affiliate click tracking + provider-agnostic redirect template
- Light/dark responsive UI
- Affiliate/privacy/terms pages
- Guardrails preventing restricted shopping categories from being searched

## First setup
1. `npm install`
2. Copy `.env.example` to `.env.local`
3. Fill `DATABASE_URL`, `AUTH_SECRET`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`
4. Add `OPENAI_API_KEY` for Ceniq AI
5. Run `npx prisma migrate deploy` (or `npm run db:push` for a fresh dev DB)
6. `npm run dev`

## Vercel
Add the same environment variables in Project Settings. `vercel.json` runs `/api/cron/alerts` once per day. Set `CRON_SECRET`; Vercel sends it as `Authorization: Bearer <CRON_SECRET>` for cron invocations.

## Optional integrations
- `AFFILIATE_REDIRECT_TEMPLATE`: use the exact template from your affiliate network. `{url}` and `{subid}` are replaced by Ceniq.
- `RESEND_API_KEY` + `ALERT_FROM_EMAIL`: email price alerts.
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: browser push.

## Important DataForSEO note
DataForSEO Google Shopping seller URLs can vary by result type and some direct URL fields are deprecated. Ceniq stores the usable URL returned by the API and routes outbound clicks through `/api/out` when an offer has been persisted.
