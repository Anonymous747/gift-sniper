import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BotService } from '../bot/bot.service';
import type { NormalizedMarketEvent } from '../events/normalized-event';
import { giftTelegramDisplayUrl } from '../lib/mrkt-telegram-link';
import { parseFeedRecipe, recipeMatchesListing, type FeedRecipe } from './feed-recipes';
import type { ArbitrageOpportunity } from '../intelligence/arbitrage-engine.service';

type ChannelRow = {
  id: string;
  slug: string;
  title: string;
  recipe: string;
  telegramChatId: string;
  enabled: boolean;
  minSniperScore: Prisma.Decimal | null;
};

@Injectable()
export class IntelFeedsDispatcherService implements OnModuleInit {
  private readonly logger = new Logger(IntelFeedsDispatcherService.name);
  private postingEnabled = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: BotService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.postingEnabled = this.config.get<string>('INTEL_FEED_POSTING_ENABLED') === '1';
    await this.bootstrapChannelsFromEnv();
  }

  private async bootstrapChannelsFromEnv(): Promise<void> {
    const raw = this.config.get<string>('INTEL_CHANNELS_JSON')?.trim();
    if (!raw) {
      this.logger.log('INTEL_CHANNELS_JSON empty — no intel channels bootstrapped');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      this.logger.warn('INTEL_CHANNELS_JSON is not valid JSON');
      return;
    }
    if (!Array.isArray(parsed)) return;
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      const slug = typeof o.slug === 'string' ? o.slug : '';
      const title = typeof o.title === 'string' ? o.title : slug;
      const recipe = typeof o.recipe === 'string' ? o.recipe : '';
      const telegramChatId = typeof o.telegramChatId === 'string' ? o.telegramChatId : '';
      if (!slug || !recipe || !telegramChatId) continue;
      if (!parseFeedRecipe(recipe)) {
        this.logger.warn(`Skipping channel ${slug}: unknown recipe ${recipe}`);
        continue;
      }
      const minSniper =
        typeof o.minSniperScore === 'number' && Number.isFinite(o.minSniperScore)
          ? new Prisma.Decimal(o.minSniperScore)
          : null;
      await this.prisma.intelFeedChannel.upsert({
        where: { slug },
        create: {
          slug,
          title,
          recipe,
          telegramChatId,
          enabled: o.enabled !== false,
          minSniperScore: minSniper,
        },
        update: {
          title,
          recipe,
          telegramChatId,
          enabled: o.enabled !== false,
          minSniperScore: minSniper,
        },
      });
    }
    this.logger.log(`Intel feed channels synced from env (${parsed.length} rows)`);
  }

  async dispatchListing(event: NormalizedMarketEvent, sniperScore: number): Promise<void> {
    if (!this.postingEnabled) return;
    const channels = await this.prisma.intelFeedChannel.findMany({ where: { enabled: true } });
    const minDecimal = (ch: ChannelRow) =>
      ch.minSniperScore != null ? Number(ch.minSniperScore) : null;

    for (const ch of channels) {
      const recipe = parseFeedRecipe(ch.recipe);
      if (!recipe || recipe === 'arbitrage') continue;
      if (!recipeMatchesListing(recipe, event, sniperScore, minDecimal(ch))) continue;
      await this.tryPostChannel(ch, event, sniperScore, recipe);
    }
  }

  async dispatchArbitrage(payload: ArbitrageOpportunity): Promise<void> {
    if (!this.postingEnabled) return;
    const channels = await this.prisma.intelFeedChannel.findMany({
      where: { enabled: true, recipe: 'arbitrage' },
    });
    const text = this.formatArbitragePost(payload);
    const dedupeKey = `arb:${payload.collectionKey}:${payload.serial}:${payload.cheapMarket}:${payload.expensiveMarket}`;
    for (const ch of channels) {
      const exists = await this.prisma.channelPost.findUnique({
        where: { channelId_eventUuid: { channelId: ch.id, eventUuid: dedupeKey } },
      });
      if (exists) continue;
      const msgId = await this.bot.sendChannelPost(ch.telegramChatId, text);
      if (msgId == null) continue;
      try {
        await this.prisma.channelPost.create({
          data: {
            channelId: ch.id,
            eventUuid: dedupeKey,
            telegramMessageId: String(msgId),
            preview: dedupeKey.slice(0, 512),
          },
        });
      } catch (err) {
        if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
  }

  private async tryPostChannel(
    ch: ChannelRow,
    event: NormalizedMarketEvent,
    sniperScore: number,
    recipe: FeedRecipe,
  ): Promise<void> {
    const exists = await this.prisma.channelPost.findUnique({
      where: { channelId_eventUuid: { channelId: ch.id, eventUuid: event.event_id } },
    });
    if (exists) return;

    const body = this.formatListingPost(ch.title, event, sniperScore, recipe);
    const msgId = await this.bot.sendChannelPost(ch.telegramChatId, body);
    if (msgId == null) return;

    try {
      await this.prisma.channelPost.create({
        data: {
          channelId: ch.id,
          eventUuid: event.event_id,
          telegramMessageId: String(msgId),
          preview: `${recipe}:${event.gift_name}`.slice(0, 512),
        },
      });
    } catch (err) {
      if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') return;
      this.logger.warn(`ChannelPost create failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private formatListingPost(
    feedTitle: string,
    event: NormalizedMarketEvent,
    sniperScore: number,
    recipe: FeedRecipe,
  ): string {
    const discount =
      event.below_floor_percent != null ? `${event.below_floor_percent.toFixed(1)}% below floor` : 'n/a';
    const link = giftTelegramDisplayUrl(event);
    const linkLine = link != null ? `\n${link}` : '';
    return (
      `⚡ ${feedTitle}\n` +
      `(${recipe})\n\n` +
      `Collection: ${event.collection}\n` +
      `Gift: ${event.gift_name}\n` +
      `Price: ${event.price_ton ?? '?'} TON\n` +
      `Floor: ${event.floor_price ?? '?'} TON\n` +
      `Discount: ${discount}\n` +
      `Sniper: ${sniperScore.toFixed(1)}\n` +
      `Market: ${event.market.toUpperCase()}` +
      linkLine
    );
  }

  private formatArbitragePost(p: ArbitrageOpportunity): string {
    return (
      `🔀 Arbitrage signal\n\n` +
      `${p.collectionKey} #${p.serial}\n` +
      `${p.cheapMarket.toUpperCase()}: ${p.cheapPrice.toFixed(2)} TON\n` +
      `${p.expensiveMarket.toUpperCase()}: ${p.expensivePrice.toFixed(2)} TON\n` +
      `Spread ≈ ${p.spreadPct.toFixed(1)}%`
    );
  }

  async listChannelsPublic(): Promise<{ slug: string; title: string; recipe: string }[]> {
    const rows = await this.prisma.intelFeedChannel.findMany({
      where: { enabled: true },
      select: { slug: true, title: true, recipe: true },
      orderBy: { slug: 'asc' },
    });
    return rows;
  }
}
