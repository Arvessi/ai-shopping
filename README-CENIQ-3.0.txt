CENIQ 3.0 — Catalog/Data Layer

WHAT THIS VERSION DOES
- CENIQ now has its own structured catalog instead of relying on Google/DataForSEO for every search.
- New data hierarchy:
  Merchant -> FeedSource -> CatalogFamily -> CatalogVariant -> CatalogOffer
- Merchant feed importer supports XML / CSV / JSON.
- Feed mapping is configurable per store.
- Product matching prefers GTIN/EAN, then MPN, then normalized attributes.
- Generic variants: storage, RAM, color, connectivity, size, condition.
- Product images can belong to variants/offers, so Black/White/etc. can show different images.
- Catalog offers store availability, stock, delivery days, shipping price and history when feeds provide them.
- Catalog search is always tried FIRST.
- DataForSEO remains only as a transitional fallback while catalog coverage is small.
- Existing frontend Product/Offer API remains compatible through a projection layer.
- Existing catalog products can refresh without calling DataForSEO.
- Monthly/installment-looking feed rows are rejected before entering catalog.
- Strong price outliers are rejected when enough comparable feed rows exist.

IMPORTANT
This package creates the ARCHITECTURE.
It will not magically create 700 stores. We still need real store XML/API/feed URLs to populate it.

INSTALL IN CODESPACE ROOT

1) Upload CENIQ-3.0-catalog-engine.zip to repository root.

2) Run:

unzip -o CENIQ-3.0-catalog-engine.zip
rm CENIQ-3.0-catalog-engine.zip

npm install
npm run db:push
npm run build

3) DO NOT PUSH if build fails.

4) Only after a clean build:

git add .
git commit -m "Build CENIQ 3.0 catalog engine"
git push

NEW ENV
No new env is mandatory.

The catalog admin API reuses CRON_SECRET:
Authorization: Bearer <CRON_SECRET>
or
x-ceniq-secret: <CRON_SECRET>

DO NOT paste CRON_SECRET into ChatGPT.

REGISTER A STORE FEED

POST /api/catalog/sources

Example JSON is included at:
catalog/examples/source-example.json

Example body:

{
  "merchant": {
    "name": "Example Shop",
    "slug": "example-shop",
    "domain": "example.lv"
  },
  "source": {
    "name": "Example XML feed",
    "slug": "example-shop-main",
    "url": "https://example.lv/products.xml",
    "format": "xml",
    "mapping": {
      "itemPath": "products.product",
      "fields": {
        "externalId": "id",
        "title": "name",
        "brand": "manufacturer",
        "model": "model",
        "category": "category",
        "gtin": "ean",
        "mpn": "mpn",
        "sku": "sku",
        "price": "price",
        "oldPrice": "old_price",
        "currency": "currency",
        "url": "url",
        "image": "image",
        "availability": "availability",
        "stockQty": "stock",
        "shippingPrice": "delivery_price",
        "deliveryDaysMin": "delivery_days_min",
        "deliveryDaysMax": "delivery_days_max",
        "color": "color",
        "storage": "storage",
        "ram": "ram",
        "condition": "condition"
      }
    }
  }
}

IMPORT ONE SOURCE

POST /api/catalog/import

{
  "sourceSlug": "example-shop-main"
}

IMPORT ALL ACTIVE SOURCES

POST /api/catalog/import

{
  "all": true
}

STATUS

GET /api/catalog/status

WHAT WE DO NEXT
- Get the first real Latvian merchant feeds/APIs.
- Add them as FeedSource records.
- Import them.
- Tune per-store field mappings.
- Once coverage is good, reduce DataForSEO fallback usage even further.
