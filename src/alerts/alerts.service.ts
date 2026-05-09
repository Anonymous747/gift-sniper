import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { FilterEngineService } from '../filters/filter-engine.service';
import { parseCriteriaJson } from '../filters/filter-criteria';
import type { NormalizedMarketEvent } from '../events/normalized-event';
import { BotService } from '../bot/bot.service';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private readonly dedupeTtl: number;
  private readonly freeDelayMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly filters: FilterEngineService,
    private readonly bot: BotService,
    config: ConfigService,
  ) {
    this.dedupeTtl = config.get<number>('ALERT_DEDUPE_TTL_SEC') ?? 300;
    this.freeDelayMs = config.get<number>('FREE_TIER_ALERT_DELAY_MS') ?? 0;
  }

  async notifyMatchingUsers(event: NormalizedMarketEvent, sniperScore: number): Promise<void> {
    if (event.event_type !== 'listing') return;

    const rows = await this.prisma.userFilter.findMany({
      where: { alertsEnabled: true },
      include: { user: true },
    });

    for (const row of rows) {
      const criteria = parseCriteriaJson(row.criteria);
      if (!this.filters.matches(criteria, event)) continue;
      if (criteria.minSniperScore != null && sniperScore < criteria.minSniperScore) continue;

      const dedupeKey = `dedupe:alert:${row.userId}:${event.event_id}`;
      const first = await this.redis.dedupeOnce(dedupeKey, this.dedupeTtl);
      if (!first) continue;

      const text = this.formatListingAlert(event, sniperScore);
      const delay = row.user.tier === 'free' ? this.freeDelayMs : 0;

      const send = async () => {
        try {
          await this.bot.sendMessage(row.user.telegramId, text);
          await this.prisma.alertLog.create({
            data: {
              userId: row.userId,
              userFilterId: row.id,
              dedupeKey,
              kind: 'listing',
              payload: event as unknown as Prisma.InputJsonValue,
            },
          });
        } catch (err) {
          this.logger.warn(`Failed to send alert to ${row.userId}: ${err instanceof Error ? err.message : err}`);
        }
      };

      if (delay > 0) {
        setTimeout(send, delay);
      } else {
        await send();
      }
    }
  }

  private formatListingAlert(e: NormalizedMarketEvent, sniperScore: number): string {
    const discount = e.below_floor_percent != null ? `${e.below_floor_percent.toFixed(1)}% below floor` : 'n/a';
    const rarity = e.rarity_rank != null ? `#${e.rarity_rank}` : 'n/a';
    return (
      `⚡ New Listing Detected\n\n` +
      `Collection: ${e.collection}\n` +
      `Gift: ${e.gift_name}\n\n` +
      `Price: ${e.price_ton ?? '?'} TON\n` +
      `Floor: ${e.floor_price ?? '?'} TON\n\n` +
      `Discount: ${discount}\n` +
      `Market: ${e.market.toUpperCase()}\n\n` +
      `Rarity Rank: ${rarity}\n` +
      `Sniper Score: ${sniperScore.toFixed(2)}`
    );
  }
}
