-- Canonical CENIQ catalog. Legacy Product/Offer rows remain available for URL and user-data migration.
ALTER TABLE "Offer" DROP CONSTRAINT IF EXISTS "Offer_productId_merchant_totalPrice_key";

CREATE TABLE IF NOT EXISTS "SearchCache" (
  "id" TEXT PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "query" TEXT NOT NULL,
  "results" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "SearchCache_expiresAt_idx" ON "SearchCache"("expiresAt");

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sourceProductId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "lastEnrichedAt" TIMESTAMP(3);
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "variantLabel" TEXT;
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "variantData" JSONB;
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "image" TEXT;
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "shippingKnown" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "Product_source_normalizedTitle_idx" ON "Product"("source", "normalizedTitle");
CREATE INDEX IF NOT EXISTS "Offer_productId_merchant_idx" ON "Offer"("productId", "merchant");

-- Experimental catalog tables existed in deployed databases without a checked-in
-- migration. Define them here so migrate deploy is reproducible from an empty DB.
CREATE TABLE IF NOT EXISTS "Merchant" (
  "id" TEXT PRIMARY KEY, "slug" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "domain" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true, "trustScore" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "Merchant_active_idx" ON "Merchant"("active");
CREATE TABLE IF NOT EXISTS "FeedSource" (
  "id" TEXT PRIMARY KEY, "merchantId" TEXT NOT NULL REFERENCES "Merchant"("id") ON DELETE CASCADE,
  "slug" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "url" TEXT NOT NULL, "format" TEXT NOT NULL,
  "mapping" JSONB NOT NULL, "authHeaderEnv" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
  "lastImportedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "FeedSource_merchantId_active_idx" ON "FeedSource"("merchantId","active");
CREATE TABLE IF NOT EXISTS "CatalogFamily" (
  "id" TEXT PRIMARY KEY, "canonicalKey" TEXT NOT NULL UNIQUE, "title" TEXT NOT NULL, "normalizedTitle" TEXT NOT NULL,
  "brand" TEXT, "model" TEXT, "category" TEXT, "image" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "CatalogFamily_normalizedTitle_idx" ON "CatalogFamily"("normalizedTitle");
CREATE INDEX IF NOT EXISTS "CatalogFamily_brand_model_idx" ON "CatalogFamily"("brand","model");
CREATE TABLE IF NOT EXISTS "CatalogVariant" (
  "id" TEXT PRIMARY KEY, "familyId" TEXT NOT NULL REFERENCES "CatalogFamily"("id") ON DELETE CASCADE,
  "variantKey" TEXT NOT NULL, "gtin" TEXT, "mpn" TEXT, "color" TEXT, "storage" TEXT, "ram" TEXT,
  "connectivity" TEXT, "size" TEXT, "condition" TEXT NOT NULL DEFAULT 'New', "attributes" JSONB, "image" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE("familyId","variantKey")
);
CREATE INDEX IF NOT EXISTS "CatalogVariant_gtin_idx" ON "CatalogVariant"("gtin");
CREATE INDEX IF NOT EXISTS "CatalogVariant_mpn_idx" ON "CatalogVariant"("mpn");
CREATE TABLE IF NOT EXISTS "CatalogOffer" (
  "id" TEXT PRIMARY KEY, "offerKey" TEXT NOT NULL UNIQUE, "sourceId" TEXT NOT NULL REFERENCES "FeedSource"("id") ON DELETE CASCADE,
  "merchantId" TEXT NOT NULL REFERENCES "Merchant"("id") ON DELETE CASCADE, "variantId" TEXT NOT NULL REFERENCES "CatalogVariant"("id") ON DELETE CASCADE,
  "externalId" TEXT, "title" TEXT NOT NULL, "url" TEXT NOT NULL, "image" TEXT, "price" DOUBLE PRECISION NOT NULL,
  "oldPrice" DOUBLE PRECISION, "currency" TEXT NOT NULL DEFAULT 'EUR', "shippingPrice" DOUBLE PRECISION,
  "deliveryDaysMin" INTEGER, "deliveryDaysMax" INTEGER, "availability" TEXT, "stockQty" INTEGER,
  "condition" TEXT NOT NULL DEFAULT 'New', "active" BOOLEAN NOT NULL DEFAULT true, "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "CatalogOffer_variantId_active_price_idx" ON "CatalogOffer"("variantId","active","price");
CREATE INDEX IF NOT EXISTS "CatalogOffer_merchantId_active_idx" ON "CatalogOffer"("merchantId","active");
CREATE INDEX IF NOT EXISTS "CatalogOffer_sourceId_active_idx" ON "CatalogOffer"("sourceId","active");
CREATE TABLE IF NOT EXISTS "CatalogPriceSnapshot" (
  "id" TEXT PRIMARY KEY, "offerId" TEXT NOT NULL REFERENCES "CatalogOffer"("id") ON DELETE CASCADE,
  "price" DOUBLE PRECISION NOT NULL, "shippingPrice" DOUBLE PRECISION, "availability" TEXT, "stockQty" INTEGER,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "CatalogPriceSnapshot_offerId_recordedAt_idx" ON "CatalogPriceSnapshot"("offerId","recordedAt");
CREATE TABLE IF NOT EXISTS "ImportRun" (
  "id" TEXT PRIMARY KEY, "sourceId" TEXT NOT NULL REFERENCES "FeedSource"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'running', "itemCount" INTEGER NOT NULL DEFAULT 0, "acceptedCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0, "error" TEXT, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "ImportRun_sourceId_startedAt_idx" ON "ImportRun"("sourceId","startedAt");
CREATE TABLE IF NOT EXISTS "CrawlSource" (
  "id" TEXT PRIMARY KEY, "slug" TEXT NOT NULL UNIQUE, "merchantId" TEXT NOT NULL REFERENCES "Merchant"("id") ON DELETE CASCADE,
  "feedSourceId" TEXT NOT NULL UNIQUE REFERENCES "FeedSource"("id") ON DELETE CASCADE, "origin" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "priority" INTEGER NOT NULL DEFAULT 50, "crawlDelayMs" INTEGER NOT NULL DEFAULT 1000,
  "robotsAllowed" BOOLEAN, "robotsCheckedAt" TIMESTAMP(3), "lastSeededAt" TIMESTAMP(3), "lastRunAt" TIMESTAMP(3), "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "CrawlSource_active_priority_idx" ON "CrawlSource"("active","priority");
CREATE TABLE IF NOT EXISTS "CrawlPage" (
  "id" TEXT PRIMARY KEY, "sourceId" TEXT NOT NULL REFERENCES "CrawlSource"("id") ON DELETE CASCADE, "url" TEXT NOT NULL,
  "urlHash" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'candidate', "status" TEXT NOT NULL DEFAULT 'pending',
  "priority" INTEGER NOT NULL DEFAULT 0, "depth" INTEGER NOT NULL DEFAULT 0, "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastHttpStatus" INTEGER, "lastError" TEXT, "lastCrawledAt" TIMESTAMP(3), "nextCrawlAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, UNIQUE("sourceId","urlHash")
);
CREATE INDEX IF NOT EXISTS "CrawlPage_sourceId_status_priority_idx" ON "CrawlPage"("sourceId","status","priority");
CREATE INDEX IF NOT EXISTS "CrawlPage_status_nextCrawlAt_idx" ON "CrawlPage"("status","nextCrawlAt");

DO $$ BEGIN CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE','QUARANTINED','ARCHIVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "IdentifierType" AS ENUM ('GTIN','EAN','UPC','MPN','SKU_ALIAS','MODEL_ALIAS'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PriceKind" AS ENUM ('ONE_TIME','MONTHLY','DEPOSIT','PLAN','UNKNOWN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ValidationStatus" AS ENUM ('ACCEPTED','QUARANTINED','REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "EnrichmentStatus" AS ENUM ('queued','running','succeeded','failed','timed_out'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE "ProductFamily" (
  "id" TEXT PRIMARY KEY, "canonicalKey" TEXT NOT NULL UNIQUE, "canonicalTitle" TEXT NOT NULL,
  "normalizedTitle" TEXT NOT NULL, "brand" TEXT, "model" TEXT, "category" TEXT,
  "familyImageUrl" TEXT, "familyImageSource" TEXT, "familyImageConfidence" DOUBLE PRECISION,
  "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ProductFamily_normalizedTitle_idx" ON "ProductFamily"("normalizedTitle");
CREATE INDEX "ProductFamily_brand_model_idx" ON "ProductFamily"("brand","model");

CREATE TABLE "ProductVariant" (
  "id" TEXT PRIMARY KEY, "familyId" TEXT NOT NULL REFERENCES "ProductFamily"("id") ON DELETE CASCADE,
  "variantKey" TEXT NOT NULL, "attributes" JSONB NOT NULL, "storage" TEXT, "ram" TEXT, "color" TEXT,
  "connectivity" TEXT, "cpu" TEXT, "gpu" TEXT, "size" TEXT, "resolution" TEXT, "panelType" TEXT,
  "refreshRate" TEXT, "kit" TEXT, "condition" TEXT NOT NULL DEFAULT 'New',
  "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, UNIQUE("familyId","variantKey")
);
CREATE INDEX "ProductVariant_familyId_status_idx" ON "ProductVariant"("familyId","status");

CREATE TABLE "VariantIdentifier" (
  "id" TEXT PRIMARY KEY, "variantId" TEXT NOT NULL REFERENCES "ProductVariant"("id") ON DELETE CASCADE,
  "type" "IdentifierType" NOT NULL, "value" TEXT NOT NULL, "normalizedValue" TEXT NOT NULL,
  "source" TEXT NOT NULL, "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("type","normalizedValue","source")
);
CREATE INDEX "VariantIdentifier_type_normalizedValue_idx" ON "VariantIdentifier"("type","normalizedValue");
CREATE INDEX "VariantIdentifier_variantId_idx" ON "VariantIdentifier"("variantId");

CREATE TABLE "VariantImage" (
  "id" TEXT PRIMARY KEY, "variantId" TEXT NOT NULL REFERENCES "ProductVariant"("id") ON DELETE CASCADE,
  "url" TEXT NOT NULL, "source" TEXT NOT NULL, "provenance" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5, "lastVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE("variantId","url")
);
CREATE INDEX "VariantImage_variantId_confidence_idx" ON "VariantImage"("variantId","confidence");

CREATE TABLE "MerchantOffer" (
  "id" TEXT PRIMARY KEY, "variantId" TEXT NOT NULL REFERENCES "ProductVariant"("id") ON DELETE CASCADE,
  "merchantId" TEXT NOT NULL REFERENCES "Merchant"("id") ON DELETE CASCADE, "sourceType" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL, "url" TEXT NOT NULL, "imageUrl" TEXT, "oneTimePrice" DOUBLE PRECISION,
  "shippingPrice" DOUBLE PRECISION, "totalPrice" DOUBLE PRECISION, "currency" TEXT NOT NULL DEFAULT 'EUR',
  "priceKind" "PriceKind" NOT NULL DEFAULT 'UNKNOWN', "availability" TEXT, "stockQty" INTEGER,
  "validationStatus" "ValidationStatus" NOT NULL DEFAULT 'QUARANTINED', "rejectionReason" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5, "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE("merchantId","sourceKey")
);
CREATE INDEX "MerchantOffer_variant_validation_price_idx" ON "MerchantOffer"("variantId","validationStatus","priceKind","totalPrice");
CREATE INDEX "MerchantOffer_freshness_idx" ON "MerchantOffer"("lastSeenAt","expiresAt");

CREATE TABLE "OfferObservation" (
  "id" TEXT PRIMARY KEY, "offerId" TEXT NOT NULL REFERENCES "MerchantOffer"("id") ON DELETE CASCADE,
  "oneTimePrice" DOUBLE PRECISION, "shippingPrice" DOUBLE PRECISION, "totalPrice" DOUBLE PRECISION,
  "priceKind" "PriceKind" NOT NULL, "availability" TEXT, "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "OfferObservation_offerId_observedAt_idx" ON "OfferObservation"("offerId","observedAt");

CREATE TABLE "ProductAlias" (
  "id" TEXT PRIMARY KEY, "alias" TEXT NOT NULL UNIQUE,
  "familyId" TEXT NOT NULL REFERENCES "ProductFamily"("id") ON DELETE CASCADE,
  "variantId" TEXT REFERENCES "ProductVariant"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "EnrichmentJob" (
  "id" TEXT PRIMARY KEY, "normalizedQuery" TEXT NOT NULL, "familyId" TEXT,
  "status" "EnrichmentStatus" NOT NULL DEFAULT 'queued', "attempts" INTEGER NOT NULL DEFAULT 0,
  "providerStage" TEXT, "providerTaskId" TEXT, "providerTaskIds" JSONB, "startedAt" TIMESTAMP(3),
  "deadlineAt" TIMESTAMP(3) NOT NULL, "finishedAt" TIMESTAMP(3), "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "EnrichmentJob_query_status_idx" ON "EnrichmentJob"("normalizedQuery","status");
CREATE INDEX "EnrichmentJob_status_deadline_idx" ON "EnrichmentJob"("status","deadlineAt");

ALTER TABLE "Wishlist" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "Wishlist" ADD COLUMN "familyId" TEXT REFERENCES "ProductFamily"("id") ON DELETE CASCADE;
ALTER TABLE "Wishlist" ADD COLUMN "variantId" TEXT REFERENCES "ProductVariant"("id") ON DELETE CASCADE;
CREATE INDEX "Wishlist_userId_familyId_variantId_idx" ON "Wishlist"("userId","familyId","variantId");

ALTER TABLE "PriceAlert" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "PriceAlert" ADD COLUMN "familyId" TEXT REFERENCES "ProductFamily"("id") ON DELETE CASCADE;
ALTER TABLE "PriceAlert" ADD COLUMN "variantId" TEXT REFERENCES "ProductVariant"("id") ON DELETE CASCADE;
CREATE INDEX "PriceAlert_active_variantId_idx" ON "PriceAlert"("active","variantId");

ALTER TABLE "AffiliateClick" ALTER COLUMN "offerId" DROP NOT NULL;
ALTER TABLE "AffiliateClick" ADD COLUMN "merchantOfferId" TEXT REFERENCES "MerchantOffer"("id") ON DELETE CASCADE;
CREATE INDEX "AffiliateClick_merchantOfferId_createdAt_idx" ON "AffiliateClick"("merchantOfferId","createdAt");

-- Preserve old catalog identities and URLs. Old prices are deliberately quarantined:
-- they were collected before one-time/full-price validation existed.
INSERT INTO "ProductFamily" ("id","canonicalKey","canonicalTitle","normalizedTitle","brand","model","category","familyImageUrl","familyImageSource","familyImageConfidence","status","createdAt","updatedAt")
SELECT "id","canonicalKey","title","normalizedTitle","brand","model","category","image",CASE WHEN "image" IS NULL THEN NULL ELSE 'legacy-catalog' END,CASE WHEN "image" IS NULL THEN NULL ELSE 0.4 END,CASE WHEN "active" THEN 'ACTIVE'::"ProductStatus" ELSE 'ARCHIVED'::"ProductStatus" END,"createdAt","updatedAt"
FROM "CatalogFamily" ON CONFLICT ("id") DO NOTHING;
INSERT INTO "ProductVariant" ("id","familyId","variantKey","attributes","storage","ram","color","connectivity","size","condition","status","createdAt","updatedAt")
SELECT "id","familyId","variantKey",COALESCE("attributes",jsonb_strip_nulls(jsonb_build_object('storage',"storage",'ram',"ram",'color',"color",'connectivity',"connectivity",'size',"size",'condition',"condition"))),"storage","ram","color","connectivity","size","condition",CASE WHEN "active" THEN 'ACTIVE'::"ProductStatus" ELSE 'ARCHIVED'::"ProductStatus" END,"createdAt","updatedAt"
FROM "CatalogVariant" ON CONFLICT ("id") DO NOTHING;
INSERT INTO "VariantIdentifier" ("id","variantId","type","value","normalizedValue","source","confidence","createdAt")
SELECT md5("id" || ':gtin'),"id",'GTIN'::"IdentifierType","gtin",lower(regexp_replace("gtin",'\s','','g')),'legacy-catalog',0.9,"createdAt" FROM "CatalogVariant" WHERE "gtin" IS NOT NULL
ON CONFLICT ("type","normalizedValue","source") DO NOTHING;
INSERT INTO "VariantIdentifier" ("id","variantId","type","value","normalizedValue","source","confidence","createdAt")
SELECT md5("id" || ':mpn'),"id",'MPN'::"IdentifierType","mpn",lower(regexp_replace("mpn",'\s','','g')),'legacy-catalog',0.8,"createdAt" FROM "CatalogVariant" WHERE "mpn" IS NOT NULL
ON CONFLICT ("type","normalizedValue","source") DO NOTHING;
INSERT INTO "VariantImage" ("id","variantId","url","source","provenance","confidence","lastVerifiedAt","createdAt","updatedAt")
SELECT md5("id" || ':image'),"id","image",'legacy-catalog','variant',0.6,NULL,"createdAt","updatedAt" FROM "CatalogVariant" WHERE "image" IS NOT NULL
ON CONFLICT ("variantId","url") DO NOTHING;
INSERT INTO "MerchantOffer" ("id","variantId","merchantId","sourceType","sourceKey","url","imageUrl","currency","priceKind","availability","stockQty","validationStatus","rejectionReason","confidence","firstSeenAt","lastSeenAt","expiresAt","createdAt","updatedAt")
SELECT "id","variantId","merchantId",'legacy-experimental',"offerKey","url","image","currency",'UNKNOWN'::"PriceKind","availability","stockQty",'QUARANTINED'::"ValidationStatus",'legacy-price-needs-revalidation',0.3,"createdAt","lastSeenAt",NULL,"createdAt","updatedAt"
FROM "CatalogOffer" ON CONFLICT ("merchantId","sourceKey") DO NOTHING;
INSERT INTO "ProductAlias" ("id","alias","familyId","variantId","createdAt")
SELECT md5(p."id" || ':alias'),p."id",substring(p."externalId" from 9),NULL,CURRENT_TIMESTAMP
FROM "Product" p JOIN "ProductFamily" f ON f."id" = substring(p."externalId" from 9)
WHERE p."externalId" LIKE 'catalog:%' ON CONFLICT ("alias") DO NOTHING;
UPDATE "Wishlist" w SET "familyId" = a."familyId" FROM "ProductAlias" a WHERE a."alias" = w."productId" AND w."familyId" IS NULL;
UPDATE "PriceAlert" p SET "familyId" = a."familyId" FROM "ProductAlias" a WHERE a."alias" = p."productId" AND p."familyId" IS NULL;
