CENIQ 3.1 — LATVIA STORE CRAWLER ENGINE

WHAT THIS PATCH DOES

- Adds 26 Latvian electronics / technology merchant targets.
- K-Senukai is intentionally NOT duplicated; 1a.lv is the single MVP operator target.
- Does NOT scrape Google or comparison engines for catalog data.
- Uses merchant robots.txt + public sitemap URLs + public product pages.
- Does not bypass bot protection. 401/403/429 pages are marked blocked and skipped.
- Reads Product/Offer JSON-LD first.
- Falls back to standard product OpenGraph/meta fields when JSON-LD is missing.
- Imports only electronics / household-tech-like products.
- Restricted categories are rejected before catalog ingestion.
- Exact variant identity priority: GTIN/EAN -> MPN -> SKU -> normalized attributes.
- Same GTIN found at another store reuses the existing variant/family.
- Variant images are stored separately, so Black/White/etc can show different images.
- Generic monthly/deposit-price protection is included.
- After 3+ comparable offers, extreme low-price outliers (<35% of median) are disabled.
- Search is catalog-first. If catalog coverage is weak, a real search can seed one new merchant and crawl queued matching URLs before using DataForSEO.
- Background catalog crawler runs once per day to remain compatible with Vercel Hobby cron limits.
- Public crawler status endpoint: /api/catalog/crawl/status

INITIAL 26-STORE POOL

220.lv
1a.lv
RD Electronics
Euronics
Tet
Dateks
M79
AiO
Baltic Data
Bite
Tele2
LMT
Samsung Latvija
iDeal
707.lv
24.lv
Discover.lv
Bigbox.lv
Signe.lv
DT24.lv
Zauers.lv
LabsVeikals.lv
Datorlietas.lv
Semikom.lv
Multicom.lv
Tera.lv

IMPORTANT

This is a generic crawler engine. A store can still be automatically marked blocked or unsupported if:
- robots.txt disallows crawling;
- the store blocks public requests;
- its product pages expose neither structured Product JSON-LD nor usable product meta fields;
- its sitemap cannot be discovered.

Those stores should later get a dedicated adapter or official feed/API. CENIQ does not bypass protections.

INSTALL — FROM CODESPACE REPOSITORY ROOT

unzip -o CENIQ-3.1-latvia-crawler.zip
rm CENIQ-3.1-latvia-crawler.zip

npm run db:push
npm run build

DO NOT PUSH IF BUILD FAILS.

ONLY AFTER CLEAN BUILD:

git add .
git commit -m "Add CENIQ 3.1 Latvia store crawler"
git push

AFTER VERCEL DEPLOYS

Open this in the browser:
https://YOUR-CENIQ-DOMAIN/api/catalog/crawl/status

You should see:
- configuredStores: 26
- crawler source list
- queued page counts / products / errors / blocked totals

Then test normal CENIQ searches such as:
- iPhone 16
- Samsung Galaxy S25
- MacBook Air

While catalog coverage is still low, each relevant search is allowed to seed one additional store automatically. The daily cron continues the background queue.

ADMIN ENDPOINTS (protected with existing CRON_SECRET)

POST /api/catalog/crawl/bootstrap
Body: {"store":"220"}

POST /api/catalog/crawl/run
Body: {"store":"220","limit":8}

Do not paste CRON_SECRET into chat.
