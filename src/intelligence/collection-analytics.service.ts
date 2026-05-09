import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { NormalizedMarketEvent } from '../events/normalized-event';
import { slugifyCollectionName } from '../lib/mrkt-telegram-link';

/**
 * Redis pulse counters + future `AnalyticsSnapshot` rollups (floors, sales/hour).
 */
@Injectable()
export class CollectionAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Placeholder — wire cron + materialized stats when MRKT history is persisted. */
  async latestSnapshot(marketSlug: string, window: string): Promise<null> {
    void this.prisma;
    void marketSlug;
    void window;
    return null;
  }

  /** Rolling 2h listing velocity per market+collection slug (for trending / demand heuristics). */
  recordListingPulse(event: NormalizedMarketEvent): void {
    if (event.event_type !== 'listing') return;
    const slug = slugifyCollectionName(event.collection);
    const key = `pulse:listings:${event.market}:${slug}`;
    void this.redis.client
      .multi()
      .incr(key)
      .expire(key, 7200)
      .exec()
      .catch(() => undefined);
  }
}

