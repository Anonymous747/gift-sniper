import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BotService } from '../bot/bot.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly bot: BotService,
  ) {}

  @Get()
  async get() {
    let database = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = true;
    } catch {
      database = false;
    }
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN')?.trim();
    const telegramTokenConfigured = Boolean(token);
    const telegramLongPolling = this.bot.isLongPolling();
    /** Booleans only — never secret values. Use to confirm server `.env` / `env_file` loaded (compare with local filled `.env`). */
    const mrktNativeAuthConfigured =
      Boolean(this.config.get<string>('MRKT_TOKEN')?.trim()) ||
      Boolean(this.config.get<string>('MRKT_INIT_DATA')?.trim());
    const mrktHttpFeedConfigured = Boolean(this.config.get<string>('MRKT_LISTINGS_URL')?.trim());
    const adminTokenConfigured = Boolean(this.config.get<string>('ADMIN_TOKEN')?.trim());
    // `ok`: process up + DB + token present + grammY polling loop active (false briefly right after boot until start() runs).
    return {
      ok: database && telegramTokenConfigured && telegramLongPolling,
      database,
      telegramTokenConfigured,
      telegramLongPolling,
      mrktNativeAuthConfigured,
      mrktHttpFeedConfigured,
      adminTokenConfigured,
    };
  }
}
