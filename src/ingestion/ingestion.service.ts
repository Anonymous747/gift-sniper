import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GiftEventType, Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { assertNormalizedEvent, type NormalizedMarketEvent } from '../events/normalized-event';
import { computeSniperScore } from '../events/sniper-score';
import { ConfigService } from '@nestjs/config';
import { AlertsService } from '../alerts/alerts.service';
import { AppEventBus } from '../realtime/app-event-bus';
import { WhaleTrackingService } from '../intelligence/whale-tracking.service';
import { CollectionAnalyticsService } from '../intelligence/collection-analytics.service';
import { ArbitrageEngineService } from '../intelligence/arbitrage-engine.service';
import { IntelFeedsDispatcherService } from '../feeds/intel-feeds-dispatcher.service';

@Injectable()
export class IngestionService implements OnModuleInit {
  private readonly logger = new Logger(IngestionService.name);
  /** When true, skip `notifyMatchingUsers` here — collector fast-path sends Telegram instead. */
  private readonly alertsFromFastPathOnly: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly bus: AppEventBus,
    private readonly whales: WhaleTrackingService,
    private readonly collectionAnalytics: CollectionAnalyticsService,
    private readonly arbitrage: ArbitrageEngineService,
    private readonly intelFeeds: IntelFeedsDispatcherService,
    private readonly config: ConfigService,
  ) {
    const fastPathOff = this.config.get<string>('FAST_ALERT_FROM_COLLECTOR')?.trim() === '0';
    const wantFastPathOnlyAlerts =
      !fastPathOff && this.config.get<string>('ALERTS_FROM_FAST_PATH_ONLY')?.trim() === '1';
    this.alertsFromFastPathOnly = wantFastPathOnlyAlerts;
  }

  onModuleInit(): void {
    const fpOff = this.config.get<string>('FAST_ALERT_FROM_COLLECTOR')?.trim() === '0';
    const fpOnly = this.config.get<string>('ALERTS_FROM_FAST_PATH_ONLY')?.trim() === '1';
    if (fpOff && fpOnly) {
      this.logger.warn(
        'FAST_ALERT_FROM_COLLECTOR=0 disables collector Telegram alerts; ingestion alerts are enabled (ALERTS_FROM_FAST_PATH_ONLY ignored in this mode).',
      );
    }
  }

  async handleNormalizedEvent(raw: unknown): Promise<void> {
    const event = assertNormalizedEvent(raw);
    const existing = await this.prisma.giftEvent.findUnique({
      where: { eventUuid: event.event_id },
    });
    if (existing) {
      return;
    }

    if (event.event_type === 'listing') {
      await this.persistListing(event);
    } else {
      await this.persistGenericEvent(event);
    }
  }

  private async persistGenericEvent(event: NormalizedMarketEvent): Promise<void> {
    const type = this.mapEventType(event.event_type);
    await this.prisma.giftEvent.create({
      data: {
        eventUuid: event.event_id,
        marketSlug: event.market,
        eventType: type,
        payload: event as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private mapEventType(t: NormalizedMarketEvent['event_type']): GiftEventType {
    switch (t) {
      case 'listing':
        return GiftEventType.listing;
      case 'sale':
        return GiftEventType.sale;
      case 'floor_update':
        return GiftEventType.floor_update;
      case 'delisting':
        return GiftEventType.delisting;
      case 'ownership_change':
        return GiftEventType.floor_update;
      default:
        return GiftEventType.listing;
    }
  }

  private async persistListing(event: NormalizedMarketEvent): Promise<void> {
    const whaleHint = await this.whales.onListing(event);
    const enriched: NormalizedMarketEvent = {
      ...event,
      whale_activity_score: whaleHint ?? event.whale_activity_score ?? null,
    };
    const sniperScore = computeSniperScore(enriched);
    const priceTon = enriched.price_ton ?? 0;
    const floorTon = enriched.floor_price;
    const belowPct = enriched.below_floor_percent;

    try {
      await this.prisma.$transaction(async (tx) => {
      const market = await tx.market.upsert({
        where: { slug: enriched.market },
        create: { slug: enriched.market, name: enriched.market.toUpperCase() },
        update: {},
      });

      const collection = await tx.collection.upsert({
        where: {
          marketId_slug: {
            marketId: market.id,
            slug: enriched.collection,
          },
        },
        create: {
          marketId: market.id,
          slug: enriched.collection,
          displayName: enriched.collection_display ?? enriched.collection,
        },
        update: {
          displayName: enriched.collection_display ?? undefined,
        },
      });

      const gift = await tx.gift.upsert({
        where: {
          collectionId_externalId: {
            collectionId: collection.id,
            externalId: enriched.gift_id,
          },
        },
        create: {
          collectionId: collection.id,
          externalId: enriched.gift_id,
          serialNumber: enriched.serial_number,
          name: enriched.gift_name,
        },
        update: {
          serialNumber: enriched.serial_number ?? undefined,
          name: enriched.gift_name,
        },
      });

      await tx.giftEvent.create({
        data: {
          eventUuid: enriched.event_id,
          marketSlug: enriched.market,
          eventType: GiftEventType.listing,
          giftId: gift.id,
          payload: enriched as unknown as Prisma.InputJsonValue,
        },
      });

      await tx.giftListing.updateMany({
        where: { giftId: gift.id, marketSlug: enriched.market, active: true },
        data: { active: false },
      });

      await tx.giftListing.create({
        data: {
          giftId: gift.id,
          marketSlug: enriched.market,
          priceTon: new Prisma.Decimal(priceTon),
          floorTon: floorTon != null ? new Prisma.Decimal(floorTon) : null,
          belowFloorPct: belowPct != null ? new Prisma.Decimal(belowPct) : null,
          sniperScore: new Prisma.Decimal(sniperScore),
          sellerId: enriched.seller_id,
          sellerName: enriched.seller_name,
          velocityHint: enriched.velocity ?? null,
          liquidityHint: enriched.liquidity_score ?? null,
          listedAt: new Date(enriched.timestamp),
        },
      });
    });
    } catch (err) {
      if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.debug(`Duplicate event skipped: ${event.event_id}`);
        return;
      }
      throw err;
    }

    this.collectionAnalytics.recordListingPulse(enriched);

    const arb = await this.arbitrage.onListing(enriched);
    if (arb) {
      await this.intelFeeds.dispatchArbitrage(arb).catch((e) => {
        this.logger.warn(`Arbitrage channel post failed: ${e instanceof Error ? e.message : e}`);
      });
    }

    await this.intelFeeds.dispatchListing(enriched, sniperScore).catch((e) => {
      this.logger.warn(`Intel feed dispatch failed: ${e instanceof Error ? e.message : e}`);
    });

    if (!this.alertsFromFastPathOnly) {
      await this.alerts.notifyMatchingUsers(enriched, sniperScore).catch((err) => {
        this.logger.error(`Alert dispatch failed: ${err instanceof Error ? err.message : err}`);
      });
    }
    this.bus.emit('listing', { event: enriched, sniperScore, ingestedAt: Date.now() });
  }
}
