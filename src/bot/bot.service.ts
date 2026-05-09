import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, GrammyError, HttpError } from 'grammy';
import { PrismaService } from '../prisma/prisma.service';
import { UserTier } from '@prisma/client';
import type { FilterCriteria } from '../filters/filter-criteria';

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private bot: Bot | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
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
      const me = await bot.api.getMe();
      this.logger.log(`Telegram token OK — bot @${me.username} (id=${me.id})`);
    } catch (err) {
      this.logger.error(
        `Telegram getMe failed (invalid token, revoked bot, or blocked egress to api.telegram.org): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }
    this.bot = bot;
    this.registerHandlers();
    // Never await bot.start(): it runs getUpdates forever and would block Nest bootstrap (HTTP + other hooks).
    void this.bot
      .start({
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
    await this.bot.api.sendMessage(telegramId, text, { parse_mode: undefined });
  }

  private registerHandlers() {
    if (!this.bot) return;

    this.bot.command('start', async (ctx) => {
      const from = ctx.from;
      if (!from) {
        await ctx.reply('Open this bot from a private chat (tap “Start” or “Open” here).').catch(() => undefined);
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
                } satisfies FilterCriteria,
              },
            },
          },
          update: { username: from.username ?? undefined },
        });
        const user = await this.prisma.user.findUnique({
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
              } satisfies FilterCriteria,
            },
          });
        }
        await ctx.reply(
          'Gift Sniper is live.\n\n' +
            'Default alert: MRKT listings ≥5% below floor.\n' +
            'Use /filter below <percent> [minTon] [maxTon] to tune.\n' +
            '/status — your tier & filters',
        );
      } catch (err) {
        this.logger.error(`/start handler failed: ${err instanceof Error ? err.stack ?? err.message : err}`);
        await ctx.reply(
          'Could not register you (database error). Check server logs and DATABASE_URL / migrations.',
        );
      }
    });

    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        'Commands:\n' +
          '/start — register + default filter\n' +
          '/filter below <pct> [minTon] [maxTon] — update default filter\n' +
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

    this.bot.command('filter', async (ctx) => {
      const from = ctx.from;
      if (!from) return;
      const text = ctx.message?.text ?? '';
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
    });

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
  }
}
