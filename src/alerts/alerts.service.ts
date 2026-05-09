import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { FilterEngineService } from '../filters/filter-engine.service';
import { parseCriteriaJson } from '../filters/filter-criteria';
import type { MarketSlug, NormalizedMarketEvent } from '../events/normalized-event';
import { BotService } from '../bot/bot.service';
import { MetricsService } from '../metrics/metrics.service';

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
    private readonly metrics: MetricsService,
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
        const t0 = Date.now();
        try {
          await this.bot.sendMessage(row.user.telegramId, text);
          this.metrics.recordAlert(Date.now() - t0, true);
          await this.prisma.alertLog.create({
            data: {
              userId: row.userId,
              userFilterId: row.id,
              dedupeKey,
              kind: 'listing',
              payload: event as unknown as Prisma.InputJsonValue,
            },
          });
          if (event.beautiful_serial && event.beautiful_label) {
            const dedupeBeautiful = `dedupe:beautiful:${row.userId}:${event.event_id}`;
            const firstB = await this.redis.dedupeOnce(dedupeBeautiful, this.dedupeTtl);
            if (firstB) {
              const t1 = Date.now();
              try {
                await this.bot.sendMessage(row.user.telegramId, this.formatBeautifulAlert(event));
                this.metrics.recordAlert(Date.now() - t1, true);
                await this.prisma.alertLog.create({
                  data: {
                    userId: row.userId,
                    userFilterId: row.id,
                    dedupeKey: dedupeBeautiful,
                    kind: 'beautiful_serial',
                    payload: event as unknown as Prisma.InputJsonValue,
                  },
                });
              } catch (err) {
                this.metrics.recordAlert(Date.now() - t1, false);
                this.logger.warn(
                  `Beautiful alert failed for ${row.userId}: ${err instanceof Error ? err.message : err}`,
                );
              }
            }
          }
        } catch (err) {
          this.metrics.recordAlert(Date.now() - t0, false);
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
    const giftLink = this.giftListingUrl(e.market, e.gift_id);
    const linkBlock = giftLink != null ? `Open gift: ${giftLink}\n\n` : '';
    const serialLine =
      e.beautiful_label != null && e.beautiful_label.length > 0
        ? `Serial pattern: ${e.beautiful_label}\n`
        : '';
    return (
      `⚡ New Listing Detected\n\n` +
      `Collection: ${e.collection}\n` +
      `Gift: ${e.gift_name}\n` +
      serialLine +
      linkBlock +
      `Price: ${e.price_ton ?? '?'} TON\n` +
      `Floor: ${e.floor_price ?? '?'} TON\n\n` +
      `Discount: ${discount}\n` +
      `Market: ${e.market.toUpperCase()}\n\n` +
      `Rarity Rank: ${rarity}\n` +
      `Sniper Score: ${sniperScore.toFixed(2)}`
    );
  }

  /**
   * MRKT opens in Telegram as @mrkt Mini App; `startapp` is the listing/gift id from their API.
   * @see https://t.me/mrkt/app?startapp=…
   */
  private giftListingUrl(market: MarketSlug, giftId: string): string | null {
    if (market !== 'mrkt' || !giftId) return null;
    return `https://t.me/mrkt/app?startapp=${encodeURIComponent(giftId)}`;
  }

  private formatBeautifulAlert(e: NormalizedMarketEvent): string {
    const link = this.giftListingUrl(e.market, e.gift_id);
    const tail = link != null ? `\n\nOpen: ${link}` : '';
    return (
      `🔥 Beautiful serial\n\n` +
      `Gift: ${e.gift_name}\n` +
      `Pattern: ${e.beautiful_label ?? 'special'}\n` +
      `Collection: ${e.collection}${tail}`
    );
  }
}
