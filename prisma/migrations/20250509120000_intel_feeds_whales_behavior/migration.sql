-- CreateTable
CREATE TABLE "WhaleWallet" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "smartMoneyScore" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "listingCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhaleWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBehavior" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBehavior_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelFeedChannel" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "recipe" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minSniperScore" DECIMAL(12,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntelFeedChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelPost" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "eventUuid" TEXT NOT NULL,
    "telegramMessageId" TEXT,
    "preview" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhaleWallet_address_key" ON "WhaleWallet"("address");

-- CreateIndex
CREATE INDEX "WhaleWallet_smartMoneyScore_idx" ON "WhaleWallet"("smartMoneyScore");

-- CreateIndex
CREATE INDEX "UserBehavior_userId_createdAt_idx" ON "UserBehavior"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntelFeedChannel_slug_key" ON "IntelFeedChannel"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPost_channelId_eventUuid_key" ON "ChannelPost"("channelId", "eventUuid");

-- AddForeignKey
ALTER TABLE "UserBehavior" ADD CONSTRAINT "UserBehavior_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelPost" ADD CONSTRAINT "ChannelPost_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "IntelFeedChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
