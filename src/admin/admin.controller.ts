import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { EventStreamService } from '../events/event-stream.service';
import { IngestionService } from '../ingestion/ingestion.service';
import { MetricsService } from '../metrics/metrics.service';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly streams: EventStreamService,
    private readonly ingestion: IngestionService,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Get('stats')
  async stats(@Headers('x-admin-token') token: string | undefined) {
    this.assertAdmin(token);
    const key = this.streams.getStreamKey();
    const [users, filters, gifts, listings, streamLen] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.userFilter.count(),
      this.prisma.gift.count(),
      this.prisma.giftListing.count({ where: { active: true } }),
      this.redis.xlen(key),
    ]);
    return {
      counts: { users, filters, gifts, active_listings: listings },
      redis_stream_key: key,
      redis_stream_length: streamLen,
      metrics: this.metrics.snapshot(),
    };
  }

  @Post('replay')
  async replay(
    @Headers('x-admin-token') token: string | undefined,
    @Body() body: { max?: number },
  ): Promise<{ replayed: number }> {
    this.assertAdmin(token);
    const max = Math.min(500, Math.max(1, body?.max ?? 50));
    const key = this.streams.getStreamKey();
    const rows = await this.redis.xrevrange(key, '+', '-', 'COUNT', max);
    let n = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (!row) continue;
      const entries = row[1];
      const idx = entries.indexOf('payload');
      if (idx === -1 || !entries[idx + 1]) continue;
      try {
        const parsed = JSON.parse(entries[idx + 1] as string) as unknown;
        await this.ingestion.handleNormalizedEvent(parsed);
        n += 1;
      } catch {
        /* skip bad payloads */
      }
    }
    return { replayed: n };
  }

  private assertAdmin(token: string | undefined): void {
    const expected = this.config.get<string>('ADMIN_TOKEN')?.trim();
    if (!expected) {
      throw new ServiceUnavailableException('ADMIN_TOKEN is not configured');
    }
    if (token !== expected) {
      throw new UnauthorizedException();
    }
  }
}
