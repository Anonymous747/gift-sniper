-- CreateEnum
CREATE TYPE "GiftEventType" AS ENUM ('listing', 'sale', 'floor_update', 'delisting');

-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('free', 'premium', 'pro');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "username" TEXT,
    "tier" "UserTier" NOT NULL DEFAULT 'free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gift" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "serialNumber" INTEGER,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftEvent" (
    "id" TEXT NOT NULL,
    "eventUuid" TEXT NOT NULL,
    "marketSlug" TEXT NOT NULL,
    "eventType" "GiftEventType" NOT NULL,
    "giftId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftListing" (
    "id" TEXT NOT NULL,
    "giftId" TEXT NOT NULL,
    "marketSlug" TEXT NOT NULL,
    "priceTon" DECIMAL(20,8) NOT NULL,
    "floorTon" DECIMAL(20,8),
    "belowFloorPct" DECIMAL(10,4),
    "sniperScore" DECIMAL(12,4),
    "sellerId" TEXT,
    "sellerName" TEXT,
    "velocityHint" TEXT,
    "liquidityHint" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "listedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFilter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "criteria" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userFilterId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "collectionSlugs" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "marketSlug" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "Market_slug_key" ON "Market"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_marketId_slug_key" ON "Collection"("marketId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Gift_collectionId_externalId_key" ON "Gift"("collectionId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftEvent_eventUuid_key" ON "GiftEvent"("eventUuid");

-- CreateIndex
CREATE INDEX "GiftEvent_marketSlug_createdAt_idx" ON "GiftEvent"("marketSlug", "createdAt");

-- CreateIndex
CREATE INDEX "GiftListing_marketSlug_active_listedAt_idx" ON "GiftListing"("marketSlug", "active", "listedAt");

-- CreateIndex
CREATE INDEX "GiftListing_sniperScore_idx" ON "GiftListing"("sniperScore");

-- CreateIndex
CREATE INDEX "UserFilter_userId_idx" ON "UserFilter"("userId");

-- CreateIndex
CREATE INDEX "AlertLog_userId_sentAt_idx" ON "AlertLog"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "AlertLog_dedupeKey_idx" ON "AlertLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "Watchlist_userId_idx" ON "Watchlist"("userId");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_marketSlug_window_capturedAt_idx" ON "AnalyticsSnapshot"("marketSlug", "window", "capturedAt");

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftEvent" ADD CONSTRAINT "GiftEvent_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftListing" ADD CONSTRAINT "GiftListing_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFilter" ADD CONSTRAINT "UserFilter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertLog" ADD CONSTRAINT "AlertLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
