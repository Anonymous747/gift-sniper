import { readFileSync } from 'fs';
import { join } from 'path';
import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Post,
  Query,
} from '@nestjs/common';
import { UserTier } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { validateTelegramWebAppInitData } from '../lib/telegram-webapp';
import { giftTelegramDisplayUrl } from '../lib/mrkt-telegram-link';
import type { NormalizedMarketEvent } from '../events/normalized-event';
import type { FilterCriteria } from '../filters/filter-criteria';
import { parseCriteriaJson } from '../filters/filter-criteria';

type CreateMiniFilterBody = {
  tab?: 'listing' | 'sale';
  collectionDisplay?: string | null;
  giftSerial?: number | null;
  minPriceTon?: number | null;
  maxPriceTon?: number | null;
  name?: string | null;
};

@Controller('mini')
export class MiniAppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private shellHtmlCached: string | null = null;

  private getShellHtml(apiPrefix: string): string {
    if (!this.shellHtmlCached) {
      const path = join(__dirname, 'mini-app-shell.html');
      this.shellHtmlCached = readFileSync(path, 'utf8');
    }
    return this.shellHtmlCached.replace('__API_PREFIX__', JSON.stringify(apiPrefix));
  }

  private validateInit(initData: string | undefined): { ok: false; reason: string } | { ok: true; telegramUserId: string } {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN')?.trim();
    if (!token) return { ok: false, reason: 'bot_not_configured' };
    const maxAge = Number(this.config.get<string>('TWA_MAX_AUTH_AGE_SEC') ?? 86400);
    const v = validateTelegramWebAppInitData(initData ?? '', token, Number.isFinite(maxAge) ? maxAge : 86400);
    if (!v.ok || !v.userId) return { ok: false, reason: v.ok ? 'no_user' : v.reason };
    return { ok: true, telegramUserId: v.userId };
  }

  private async ensureUser(telegramUserId: string) {
    await this.prisma.user.upsert({
      where: { telegramId: telegramUserId },
      create: {
        telegramId: telegramUserId,
        tier: UserTier.free,
        filters: {
          create: {
            name: 'Default',
            alertsEnabled: true,
            criteria: {
              markets: ['mrkt'],
              belowFloorPercentMin: 5,
              alertTab: 'listing',
            } satisfies FilterCriteria as object,
          },
        },
      },
      update: {},
    });
    let user = await this.prisma.user.findUnique({
      where: { telegramId: telegramUserId },
      include: { filters: true },
    });
    if (user && user.filters.length === 0) {
      await this.prisma.userFilter.create({
        data: {
          userId: user.id,
          name: 'Default',
          alertsEnabled: true,
          criteria: {
            markets: ['mrkt'],
            belowFloorPercentMin: 5,
            alertTab: 'listing',
          } satisfies FilterCriteria as object,
        },
      });
      user = await this.prisma.user.findUnique({
        where: { telegramId: telegramUserId },
        include: { filters: true },
      });
    }
    return user;
  }

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  shell(): string {
    const base = (this.config.get<string>('PUBLIC_APP_BASE_URL') ?? '').replace(/\/$/, '');
    return this.getShellHtml(base);
  }

  @Get('me')
  async me(@Headers('x-telegram-init-data') initData: string | undefined) {
    const v = this.validateInit(initData);
    if (!v.ok) return { ok: false as const, reason: v.reason };
    const user = await this.ensureUser(v.telegramUserId);
    if (!user) return { ok: false as const, reason: 'user_missing' };

    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const listingAlertsToday = await this.prisma.alertLog.count({
      where: { userId: user.id, kind: 'listing', sentAt: { gte: start } },
    });
    const listingAlertLimit = user.tier === UserTier.free ? 1 : 50;
    const saleAlertsToday = await this.prisma.alertLog.count({
      where: { userId: user.id, kind: 'sale', sentAt: { gte: start } },
    });
    const saleAlertLimit = user.tier === UserTier.free ? 1 : 50;

    return {
      ok: true as const,
      tier: user.tier,
      listingAlertsToday,
      listingAlertLimit,
      saleAlertsToday,
      saleAlertLimit,
    };
  }

  @Get('filters')
  async filters(
    @Headers('x-telegram-init-data') initData: string | undefined,
    @Query('tab') tab: string | undefined,
  ) {
    const v = this.validateInit(initData);
    if (!v.ok) return { ok: false as const, reason: v.reason };
    const user = await this.ensureUser(v.telegramUserId);
    if (!user) return { ok: false as const, reason: 'user_missing' };

    const wantTab = tab === 'sale' ? 'sale' : 'listing';
    const rows = await this.prisma.userFilter.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    const filters = rows
      .filter((r) => {
        const c = parseCriteriaJson(r.criteria);
        const t = c.alertTab ?? 'listing';
        return t === wantTab;
      })
      .map((r) => ({
        id: r.id,
        name: r.name,
        criteria: parseCriteriaJson(r.criteria),
        alertsEnabled: r.alertsEnabled,
      }));

    return { ok: true as const, filters };
  }

  @Get('collections')
  async collections(@Headers('x-telegram-init-data') initData: string | undefined) {
    const v = this.validateInit(initData);
    if (!v.ok) return { ok: false as const, reason: v.reason };
    await this.ensureUser(v.telegramUserId);

    const market = await this.prisma.market.findUnique({ where: { slug: 'mrkt' } });
    if (!market) return { ok: true as const, names: [] as string[] };

    const rows = await this.prisma.collection.findMany({
      where: { marketId: market.id },
      select: { displayName: true },
      distinct: ['displayName'],
      orderBy: { displayName: 'asc' },
      take: 400,
    });
    const names = rows.map((r) => r.displayName).filter((n) => n.length > 0);
    return { ok: true as const, names };
  }

  @Post('filters')
  async createFilter(
    @Headers('x-telegram-init-data') initData: string | undefined,
    @Body() body: CreateMiniFilterBody,
  ) {
    const v = this.validateInit(initData);
    if (!v.ok) return { ok: false as const, reason: v.reason };
    const user = await this.ensureUser(v.telegramUserId);
    if (!user) return { ok: false as const, reason: 'user_missing' };

    const tab = body.tab === 'sale' ? 'sale' : 'listing';
    const coll = body.collectionDisplay?.trim();
    const serial =
      body.giftSerial != null && Number.isFinite(Number(body.giftSerial))
        ? Math.floor(Number(body.giftSerial))
        : undefined;

    const minP =
      body.minPriceTon != null && Number.isFinite(Number(body.minPriceTon))
        ? Number(body.minPriceTon)
        : undefined;
    const maxP =
      body.maxPriceTon != null && Number.isFinite(Number(body.maxPriceTon))
        ? Number(body.maxPriceTon)
        : undefined;

    if (minP != null && maxP != null && minP > maxP) {
      return { ok: false as const, reason: 'min_price_gt_max' };
    }

    const criteria: FilterCriteria = {
      markets: ['mrkt'],
      alertTab: tab,
      collectionsInclude: coll ? [coll] : undefined,
      giftSerial: serial,
      minPriceTon: minP,
      maxPriceTon: maxP,
    };

    const labelParts: string[] = [];
    if (coll) labelParts.push(coll);
    if (serial != null) labelParts.push('#' + serial);
    const autoName =
      body.name?.trim() ||
      (labelParts.length ? `Фильтр · ${labelParts.join(' ')}` : tab === 'sale' ? 'Продажа · новый' : 'Листинг · новый');

    await this.prisma.userFilter.create({
      data: {
        userId: user.id,
        name: autoName.slice(0, 120),
        alertsEnabled: true,
        criteria: criteria as object,
      },
    });

    return { ok: true as const };
  }

  @Get('listings')
  async listings(@Headers('x-telegram-init-data') initData: string | undefined) {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN')?.trim();
    if (!token) {
      return { ok: false as const, reason: 'bot_not_configured' };
    }
    const maxAge = Number(this.config.get<string>('TWA_MAX_AUTH_AGE_SEC') ?? 86400);
    const v = validateTelegramWebAppInitData(initData ?? '', token, Number.isFinite(maxAge) ? maxAge : 86400);
    if (!v.ok) {
      return { ok: false as const, reason: v.reason };
    }

    const rows = await this.prisma.giftListing.findMany({
      take: 40,
      where: { active: true },
      orderBy: { listedAt: 'desc' },
      include: {
        gift: { include: { collection: true } },
      },
    });

    const listings = rows.map((r) => {
      const c = r.gift.collection;
      const pseudo: Pick<
        NormalizedMarketEvent,
        | 'market'
        | 'gift_id'
        | 'collection'
        | 'serial_number'
        | 'collection_slug'
        | 'collection_display'
      > = {
        market: r.marketSlug as NormalizedMarketEvent['market'],
        gift_id: r.gift.externalId,
        collection: c.displayName ?? c.slug,
        collection_display: c.displayName ?? undefined,
        collection_slug: c.slug,
        serial_number: r.gift.serialNumber,
      };
      const link = giftTelegramDisplayUrl({
        ...pseudo,
        nft_telegram_suffix: null,
        event_id: '',
        event_type: 'listing',
        gift_name: r.gift.name,
        price_ton: Number(r.priceTon),
        floor_price: r.floorTon != null ? Number(r.floorTon) : null,
        below_floor_percent: null,
        rarity_rank: null,
        rarity_score: null,
        seller_id: null,
        seller_name: null,
        timestamp: Date.now(),
      } as NormalizedMarketEvent);
      return {
        id: r.id,
        title: r.gift.name,
        collection: c.displayName ?? c.slug,
        market: r.marketSlug,
        priceTon: Number(r.priceTon),
        sniperScore: r.sniperScore != null ? Number(r.sniperScore) : null,
        link,
      };
    });

    return { ok: true as const, listings };
  }
}
