CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "Product" (
  "id" TEXT PRIMARY KEY,
  "externalId" TEXT NOT NULL UNIQUE,
  "gid" TEXT,
  "dataDocId" TEXT,
  "title" TEXT NOT NULL,
  "normalizedTitle" TEXT NOT NULL,
  "brand" TEXT,
  "category" TEXT,
  "description" TEXT,
  "image" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "currentBestPrice" DOUBLE PRECISION,
  "dealScore" INTEGER NOT NULL DEFAULT 50,
  "source" TEXT NOT NULL DEFAULT 'dataforseo',
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "Offer" (
  "id" TEXT PRIMARY KEY,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
  "merchant" TEXT NOT NULL,
  "merchantDomain" TEXT,
  "price" DOUBLE PRECISION NOT NULL,
  "shipping" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalPrice" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "sellerRating" DOUBLE PRECISION,
  "sellerVotes" INTEGER,
  "deliveryMessage" TEXT,
  "rawUrl" TEXT,
  "dealScore" INTEGER NOT NULL DEFAULT 50,
  "isCheapest" BOOLEAN NOT NULL DEFAULT false,
  "isBestOverall" BOOLEAN NOT NULL DEFAULT false,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE("productId", "merchant", "totalPrice")
);
CREATE INDEX "Offer_productId_totalPrice_idx" ON "Offer"("productId", "totalPrice");
CREATE TABLE "PriceSnapshot" (
  "id" TEXT PRIMARY KEY,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
  "price" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PriceSnapshot_productId_recordedAt_idx" ON "PriceSnapshot"("productId", "recordedAt");
CREATE TABLE "Wishlist" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("userId", "productId")
);
CREATE TABLE "PriceAlert" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
  "targetPrice" DOUBLE PRECISION NOT NULL,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
  "browserEnabled" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastTriggeredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "PriceAlert_active_productId_idx" ON "PriceAlert"("active", "productId");
CREATE TABLE "SearchLog" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "query" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'search',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SearchLog_createdAt_idx" ON "SearchLog"("createdAt");
CREATE TABLE "PushSubscription" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "endpoint" TEXT NOT NULL UNIQUE,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "AffiliateClick" (
  "id" TEXT PRIMARY KEY,
  "offerId" TEXT NOT NULL REFERENCES "Offer"("id") ON DELETE CASCADE,
  "subId" TEXT NOT NULL,
  "userAgent" TEXT,
  "referer" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AffiliateClick_offerId_createdAt_idx" ON "AffiliateClick"("offerId", "createdAt");
