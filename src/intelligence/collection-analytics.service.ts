import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Future: floor history, sales/hour, unique buyers, trend detection.
 * `AnalyticsSnapshot` in Prisma is reserved for periodic rollups.
 */
@Injectable()
export class CollectionAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Placeholder — wire cron + materialized stats when MRKT history is persisted. */
  async latestSnapshot(marketSlug: string, window: string): Promise<null> {
    void this.prisma;
    void marketSlug;
    void window;
    return null;
  }
}
