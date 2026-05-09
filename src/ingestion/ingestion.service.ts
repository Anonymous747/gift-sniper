import { Injectable, Logger } from '@nestjs/common';
import { GiftEventType, Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { assertNormalizedEvent, type NormalizedMarketEvent } from '../events/normalized-event';
import { computeSniperScore } from '../events/sniper-score';
import { ConfigService } from '@nestjs/config';
import { AlertsService } from '../alerts/alerts.service';
import { AppEventBus } from '../realtime/app-event-bus';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly alertsFromFastPathOnly: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly bus: AppEventBus,
    config: ConfigService,
  ) {
    this.alertsFromFastPathOnly = config.get<string>('ALERTS_FROM_FAST_PATH_ONLY') === '1';
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
    const sniperScore = computeSniperScore(event);
    const priceTon = event.price_ton ?? 0;
    const floorTon = event.floor_price;
    const belowPct = event.below_floor_percent;

    try {
      await this.prisma.$transaction(async (tx) => {
      const market = await tx.market.upsert({
        where: { slug: event.market },
        create: { slug: event.market, name: event.market.toUpperCase() },
        update: {},
      });

      const collection = await tx.collection.upsert({
        where: {
          marketId_slug: {
            marketId: market.id,
            slug: event.collection,
          },
        },
        create: {
          marketId: market.id,
          slug: event.collection,
          displayName: event.collection_display ?? event.collection,
        },
        update: {
          displayName: event.collection_display ?? undefined,
        },
      });

      const gift = await tx.gift.upsert({
        where: {
          collectionId_externalId: {
            collectionId: collection.id,
            externalId: event.gift_id,
          },
        },
        create: {
          collectionId: collection.id,
          externalId: event.gift_id,
          serialNumber: event.serial_number,
          name: event.gift_name,
        },
        update: {
          serialNumber: event.serial_number ?? undefined,
          name: event.gift_name,
        },
      });

      await tx.giftEvent.create({
        data: {
          eventUuid: event.event_id,
          marketSlug: event.market,
          eventType: GiftEventType.listing,
          giftId: gift.id,
          payload: event as unknown as Prisma.InputJsonValue,
        },
      });

      await tx.giftListing.updateMany({
        where: { giftId: gift.id, marketSlug: event.market, active: true },
        data: { active: false },
      });

      await tx.giftListing.create({
        data: {
          giftId: gift.id,
          marketSlug: event.market,
          priceTon: new Prisma.Decimal(priceTon),
          floorTon: floorTon != null ? new Prisma.Decimal(floorTon) : null,
          belowFloorPct: belowPct != null ? new Prisma.Decimal(belowPct) : null,
          sniperScore: new Prisma.Decimal(sniperScore),
          sellerId: event.seller_id,
          sellerName: event.seller_name,
          velocityHint: event.velocity ?? null,
          liquidityHint: event.liquidity_score ?? null,
          listedAt: new Date(event.timestamp),
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

    if (!this.alertsFromFastPathOnly) {
      await this.alerts.notifyMatchingUsers(event, sniperScore).catch((err) => {
        this.logger.error(`Alert dispatch failed: ${err instanceof Error ? err.message : err}`);
      });
    }
    this.bus.emit('listing', { event, sniperScore, ingestedAt: Date.now() });
  }
}
