import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { FilterEngineService } from '../filters/filter-engine.service';
import { parseCriteriaJson } from '../filters/filter-criteria';
import type { NormalizedMarketEvent } from '../events/normalized-event';
import { formatGiftListingTelegramCard, giftSeriesFooterExtraLine } from '../lib/format-gift-listing-card';
import { BotService } from '../bot/bot.service';
import { MetricsService } from '../metrics/metrics.service';
import { TonUsdRateService } from '../pricing/ton-usd-rate.service';
import { GiftTelegramLinkResolverService } from '../mrkt-link/gift-telegram-link-resolver.service';

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
    private readonly tonUsdRateService: TonUsdRateService,
    private readonly giftLinkResolver: GiftTelegramLinkResolverService,
    config: ConfigService,
  ) {
    this.dedupeTtl = config.get<number>('ALERT_DEDUPE_TTL_SEC') ?? 300;
    this.freeDelayMs = config.get<number>('FREE_TIER_ALERT_DELAY_MS') ?? 0;
  }

  async notifyMatchingUsers(event: NormalizedMarketEvent, sniperScore: number): Promise<void> {
    if (event.event_type !== 'listing') return;

    const tonUsdRate = await this.tonUsdRateService.getEffectiveRate();
    const giftLineUrl = await this.giftLinkResolver.displayUrlForListing(event);

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

      const text = this.formatListingAlert(event, sniperScore, tonUsdRate, giftLineUrl);
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
                await this.bot.sendMessage(
                  row.user.telegramId,
                  this.formatBeautifulAlert(event, giftLineUrl),
                );
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

  private formatListingAlert(
    e: NormalizedMarketEvent,
    sniperScore: number,
    tonUsdRate: number | null,
    giftLineUrl: string | null,
  ): string {
    const serialLine =
      e.beautiful_label != null && e.beautiful_label.length > 0
        ? `\n\n✨ Serial pattern: ${e.beautiful_label}`
        : '';
    const card = formatGiftListingTelegramCard(e, {
      headline: '⚡ New listing',
      tonUsdRate,
      sniperScore,
      giftLineUrl,
    });
    const seriesExtra = giftSeriesFooterExtraLine(e);
    const seriesBlock = seriesExtra != null ? `\n\n${seriesExtra}` : '';
    return `${card}${seriesBlock}${serialLine}`;
  }

  private formatBeautifulAlert(e: NormalizedMarketEvent, giftLineUrl: string | null): string {
    const tail = giftLineUrl != null ? `\n\n${giftLineUrl}` : '';
    const seriesExtra = giftSeriesFooterExtraLine(e);
    const seriesBlock = seriesExtra != null ? `\n${seriesExtra}` : '';
    return (
      `🔥 Beautiful serial\n\n` +
      `Gift: ${e.gift_name}\n` +
      `Pattern: ${e.beautiful_label ?? 'special'}${seriesBlock}${tail}`
    );
  }
}
