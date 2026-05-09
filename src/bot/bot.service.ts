import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, type Context, GrammyError, HttpError } from 'grammy';
import { PrismaService } from '../prisma/prisma.service';
import { UserTier } from '@prisma/client';
import type { FilterCriteria } from '../filters/filter-criteria';
import { RecommendationEngineService } from '../intelligence/recommendation-engine.service';

@Injectable()
export class BotService implements OnModuleDestroy, OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  private bot: Bot | null = null;
  private longPollingStarted = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly recommendations: RecommendationEngineService,
  ) {}

  async onModuleInit() {
    const raw = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    const token = raw?.trim();
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set; bot disabled');
      return;
    }
    const bot = new Bot(token);
    try {
      await bot.init();
      this.logger.log(`Telegram token OK — bot @${bot.botInfo.username} (id=${bot.botInfo.id})`);
      const wh = await bot.api.getWebhookInfo();
      this.logger.log(
        `Telegram webhook: url=${wh.url?.length ? wh.url : '(none)'}, pending_updates=${wh.pending_update_count ?? 0}`,
      );
    } catch (err) {
      this.logger.error(
        `Telegram init/getMe failed (invalid token, revoked bot, or blocked egress to api.telegram.org): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }
    const botUsername = bot.botInfo.username ?? '';
    this.bot = bot;
    this.registerHandlers(botUsername);
  }

  /**
   * Starts grammY long polling. Call from `main.ts` **after** `app.listen()` so HTTP
   * (e.g. /health) is reachable before getUpdates competes with any stale deploy.
   */
  startLongPolling(): void {
    if (!this.bot || this.longPollingStarted) return;
    this.longPollingStarted = true;
    void this.bot
      .start({
        drop_pending_updates: this.config.get<string>('TELEGRAM_DROP_PENDING_UPDATES') === '1',
        onStart: (info) =>
          this.logger.log(`Telegram long-polling active @${info.username} (deleteWebhook + getUpdates)`),
      })
      .catch((err) => {
        this.logger.error(
          `Telegram bot failed to start (webhook conflict, 409 duplicate bot, network): ${
            err instanceof Error ? err.stack ?? err.message : String(err)
          }`,
        );
      });
  }

  async onModuleDestroy() {
    if (this.bot) {
      await this.bot.stop();
    }
  }

  /** True while grammY simple long-polling loop is running. */
  isLongPolling(): boolean {
    return this.bot?.isRunning() ?? false;
  }

  async sendMessage(telegramId: string, text: string): Promise<void> {
    if (!this.bot) {
      this.logger.debug(`Bot disabled; would send: ${text.slice(0, 80)}…`);
      return;
    }
    await this.bot.api.sendMessage(telegramId, text, {
      parse_mode: undefined,
      link_preview_options: { is_disabled: true },
    });
  }

  /** Post to a Telegram channel / supergroup where the bot is admin (same bot token). */
  async sendChannelPost(chatId: string, text: string): Promise<number | null> {
    if (!this.bot) return null;
    try {
      const m = await this.bot.api.sendMessage(chatId, text, {
        parse_mode: undefined,
        link_preview_options: { is_disabled: true },
      });
      return m.message_id;
    } catch (err) {
      this.logger.warn(
        `sendChannelPost ${chatId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Plain `/start` text from the raw update. Covers every message-like branch Telegram uses
   * (private, business, edited, channel) — more reliable than `bot.command` / filter-only paths.
   */
  private textFromRawUpdate(ctx: Context): string | undefined {
    const u = ctx.update;
    const cq = u.callback_query?.message;
    const cqText =
      cq && 'text' in cq && typeof cq.text === 'string' ? cq.text : undefined;
    return (
      u.message?.text ??
      u.edited_message?.text ??
      u.channel_post?.text ??
      u.edited_channel_post?.text ??
      u.business_message?.text ??
      u.edited_business_message?.text ??
      cqText
    );
  }

  private matchStartCommandText(text: string, botUsername: string): boolean {
    let t = text.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
    t = t.trimStart();
    const first = (t.split(/\s/)[0] ?? '').split('\n')[0] ?? '';
    if (first === '/start') return true;
    if (!botUsername) return false;
    const m = first.match(/^\/start@([A-Za-z0-9_]+)$/i);
    return m != null && m[1].toLowerCase() === botUsername.toLowerCase();
  }

  private registerHandlers(botUsername: string) {
    if (!this.bot) return;

    this.bot.catch((err) => {
      const e = err.error;
      if (e instanceof GrammyError) {
        this.logger.error(`GrammyError: ${e.description}`);
      } else if (e instanceof HttpError) {
        this.logger.error(`HttpError: ${e}`);
      } else {
        this.logger.error(`Bot error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      }
    });

    if (this.config.get<string>('LOG_TELEGRAM_UPDATES') === '1') {
      this.bot.use(async (ctx, next) => {
        const u = ctx.update;
        const keys = Object.keys(u).filter((k) => k !== 'update_id');
        const preview = this.textFromRawUpdate(ctx);
        this.logger.log(
          `TG update ${u.update_id}: ${keys.join(',')}${preview != null ? ` text=${JSON.stringify(preview.slice(0, 80))}` : ''}`,
        );
        await next();
      });
    }

    this.bot.use(async (ctx, next) => {
      const text = this.textFromRawUpdate(ctx);
      if (text != null && this.matchStartCommandText(text, botUsername)) {
        await this.handleStart(ctx);
        return;
      }
      await next();
    });

    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        'Commands:\n' +
          '/start — register + default filter\n' +
          '/filter below <pct> [minTon] [maxTon] — update default filter\n' +
          '/feeds — configured intel channels (network)\n' +
          '/alerts — alert types\n' +
          '/discover — personalized feed ideas\n' +
          '/watchlist — list watchlists\n' +
          '/watchlist add <name> <collection> [more…] — new watchlist\n' +
          '/premium — tiers\n' +
          '/status — show profile\n' +
          '/mute — disable alerts\n' +
          '/unmute — enable alerts',
      );
    });

    this.bot.command('status', async (ctx) => {
      const from = ctx.from;
      if (!from) return;
      const u = await this.prisma.user.findUnique({
        where: { telegramId: String(from.id) },
        include: { filters: true },
      });
      if (!u) {
        await ctx.reply('Run /start first.');
        return;
      }
      const f = u.filters[0];
      await ctx.reply(`Tier: ${u.tier}\nDefault filter: ${f ? JSON.stringify(f.criteria) : 'none'}`);
    });

    this.bot.command('mute', async (ctx) => {
      const from = ctx.from;
      if (!from) return;
      await this.prisma.userFilter.updateMany({
        where: { user: { telegramId: String(from.id) } },
        data: { alertsEnabled: false },
      });
      await ctx.reply('Alerts muted.');
    });

    this.bot.command('unmute', async (ctx) => {
      const from = ctx.from;
      if (!from) return;
      await this.prisma.userFilter.updateMany({
        where: { user: { telegramId: String(from.id) } },
        data: { alertsEnabled: true },
      });
      await ctx.reply('Alerts enabled.');
    });

    this.bot.command('feeds', async (ctx) => {
      const rows = await this.prisma.intelFeedChannel.findMany({
        where: { enabled: true },
        orderBy: { slug: 'asc' },
        select: { slug: true, title: true, recipe: true },
      });
      if (rows.length === 0) {
        await ctx.reply(
          'No intel channels in DB yet. Set INTEL_CHANNELS_JSON + run migration, then INTEL_FEED_POSTING_ENABLED=1.',
        );
        return;
      }
      const lines = rows.map((r) => `• ${r.slug} — ${r.title} (${r.recipe})`);
      await ctx.reply(`Intelligent feed network (DB):\n${lines.join('\n')}`);
    });

    this.bot.command('alerts', async (ctx) => {
      await ctx.reply(
        'Alert types (DM):\n' +
          '• New listing snipes (filter match)\n' +
          '• Beautiful serial bonus message\n' +
          'Channels (optional): sniper_high, beautiful_serial, whale_activity, rare_finder, fast_flip, cheap_rare, arbitrage — see /feeds',
      );
    });

    this.bot.command('premium', async (ctx) => {
      await ctx.reply(
        'Tiers (schema): free · premium · pro\n' +
          'Free: delayed alerts optional (FREE_TIER_ALERT_DELAY_MS), public discovery via /discover.\n' +
          'Premium (planned): instant alerts, private intel feeds, more filters.\n' +
          'Pro (planned): API keys, terminal-style exports.',
      );
    });

    this.bot.command('discover', async (ctx) => {
      const from = ctx.from;
      if (!from) return;
      const u = await this.prisma.user.findUnique({ where: { telegramId: String(from.id) } });
      if (!u) {
        await ctx.reply('Run /start first.');
        return;
      }
      await this.logBehavior(u.id, 'command_discover', {});
      const tips = await this.recommendations.suggestFeedsForUser(u.id);
      const body = tips.map((t) => `• ${t.title}\n  ${t.reason}`).join('\n\n');
      await ctx.reply(`Suggested angles:\n\n${body}`);
    });

    this.bot.command('watchlist', async (ctx) => {
      const from = ctx.from;
      if (!from) return;
      const u = await this.prisma.user.findUnique({
        where: { telegramId: String(from.id) },
        include: { watchlists: true },
      });
      if (!u) {
        await ctx.reply('Run /start first.');
        return;
      }
      const text = this.textFromRawUpdate(ctx) ?? '';
      const args = text.split(/\s+/).slice(1);
      if (args[0]?.toLowerCase() === 'add' && args.length >= 3) {
        const name = args[1]!;
        const slugs = args.slice(2).map((s) => s.trim()).filter(Boolean);
        await this.prisma.watchlist.create({
          data: { userId: u.id, name, collectionSlugs: slugs },
        });
        await this.logBehavior(u.id, 'watchlist_add', { name, slugs });
        await ctx.reply(`Watchlist “${name}” saved: ${slugs.join(', ')}`);
        return;
      }
      if (u.watchlists.length === 0) {
        await ctx.reply('No watchlists. Use:\n/watchlist add MyAlpha Sakura LunarSnake');
        return;
      }
      const lines = u.watchlists.map((w) => `• ${w.name}: ${w.collectionSlugs.join(', ') || '(empty)'}`);
      await ctx.reply(`Your watchlists:\n${lines.join('\n')}`);
    });

    this.bot.command('filter', async (ctx) => {
      const from = ctx.from;
      if (!from) return;
      const text = this.textFromRawUpdate(ctx) ?? '';
      const args = text.split(/\s+/).slice(1);
      if (args[0]?.toLowerCase() !== 'below' || args[1] == null) {
        await ctx.reply('Usage: /filter below <percent> [minTon] [maxTon]');
        return;
      }
      const pct = Number(args[1]);
      if (!Number.isFinite(pct)) {
        await ctx.reply('Percent must be a number.');
        return;
      }
      const minTon = args[2] != null ? Number(args[2]) : undefined;
      const maxTon = args[3] != null ? Number(args[3]) : undefined;
      const user = await this.prisma.user.findUnique({ where: { telegramId: String(from.id) } });
      if (!user) {
        await ctx.reply('Run /start first.');
        return;
      }
      const criteria: FilterCriteria = {
        markets: ['mrkt'],
        belowFloorPercentMin: pct,
        minPriceTon: Number.isFinite(minTon!) ? minTon : undefined,
        maxPriceTon: Number.isFinite(maxTon!) ? maxTon : undefined,
        alertTab: 'listing',
      };
      const first = await this.prisma.userFilter.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      });
      if (first) {
        await this.prisma.userFilter.update({
          where: { id: first.id },
          data: { criteria: criteria as object },
        });
      } else {
        await this.prisma.userFilter.create({
          data: { userId: user.id, name: 'Default', criteria: criteria as object },
        });
      }
      await ctx.reply(`Updated filter: ${JSON.stringify(criteria)}`);
      await this.logBehavior(user.id, 'filter_update', criteria as object);
    });
  }

  private async logBehavior(userId: string, action: string, payload: object): Promise<void> {
    try {
      await this.prisma.userBehavior.create({
        data: { userId, action, payload },
      });
    } catch (err) {
      this.logger.debug(`logBehavior skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async handleStart(ctx: Context): Promise<void> {
    const from = ctx.from;
    if (!from) {
      await this.safeReply(ctx, 'Open this bot from a private chat (tap “Start” or “Open” here).');
      return;
    }
    const tid = String(from.id);
    try {
      await this.prisma.user.upsert({
        where: { telegramId: tid },
        create: {
          telegramId: tid,
          username: from.username ?? null,
          tier: UserTier.free,
          filters: {
            create: {
              name: 'Default',
              alertsEnabled: true,
              criteria: {
                markets: ['mrkt'],
                belowFloorPercentMin: 5,
                alertTab: 'listing',
              } satisfies FilterCriteria,
            },
          },
        },
        update: { username: from.username ?? undefined },
      });
      let user = await this.prisma.user.findUnique({
        where: { telegramId: tid },
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
            } satisfies FilterCriteria,
          },
        });
        user = await this.prisma.user.findUnique({
          where: { telegramId: tid },
          include: { filters: true },
        });
      }
      if (user) await this.logBehavior(user.id, 'command_start', {});

      await this.safeReply(
        ctx,
          'Gift Sniper is live.\n\n' +
          'Default alert: MRKT listings ≥5% below floor.\n' +
          'Use /filter below <percent> [minTon] [maxTon] to tune.\n' +
          '/feeds /discover /watchlist — intelligence layer\n' +
          '/status — your tier & filters',
      );
    } catch (err) {
      this.logger.error(`/start handler failed: ${err instanceof Error ? err.stack ?? err.message : err}`);
      await this.safeReply(
        ctx,
        'Could not register you (database error). Check server logs and DATABASE_URL / migrations.',
      );
    }
  }

  private async safeReply(ctx: Context, text: string): Promise<void> {
    try {
      await ctx.reply(text);
    } catch (err) {
      this.logger.error(
        `ctx.reply failed (chatId=${String(ctx.chatId)}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
