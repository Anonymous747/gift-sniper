import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { NormalizedMarketEvent } from '../events/normalized-event';

/**
 * Seller-wallet rollups from listing events → `smartMoneyScore` (0–100) and sniper `whale_activity_score` (0–12).
 */
@Injectable()
export class WhaleTrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async readSmartMoneyScore(address: string): Promise<number | null> {
    const row = await this.prisma.whaleWallet.findUnique({ where: { address } });
    if (!row) return null;
    return Number(row.smartMoneyScore);
  }

  /**
   * Upserts wallet stats for `event.seller_id` and returns a whale component for sniper scoring (0–12).
   */
  async onListing(event: NormalizedMarketEvent): Promise<number | null> {
    const addr = event.seller_id?.trim();
    if (!addr) return null;

    await this.prisma.whaleWallet.upsert({
      where: { address: addr },
      create: {
        address: addr,
        listingCount: 1,
        smartMoneyScore: new Prisma.Decimal(5),
        lastActivityAt: new Date(event.timestamp),
      },
      update: {
        listingCount: { increment: 1 },
        lastActivityAt: new Date(event.timestamp),
      },
    });

    const row = await this.prisma.whaleWallet.findUnique({ where: { address: addr } });
    if (!row) return null;

    const bump = Math.min(60, 5 + row.listingCount * 3);
    await this.prisma.whaleWallet.update({
      where: { address: addr },
      data: { smartMoneyScore: new Prisma.Decimal(bump) },
    });

    return Math.min(12, bump / 5);
  }
}
