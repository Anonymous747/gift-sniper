import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type FeedSuggestion = { title: string; reason: string; recipeHint: string };

/**
 * Rule-based discovery (no ML) — uses watchlists + filter markets to suggest intel feeds.
 */
@Injectable()
export class RecommendationEngineService {
  constructor(private readonly prisma: PrismaService) {}

  async suggestFeedsForUser(userId: string): Promise<FeedSuggestion[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { watchlists: true, filters: { take: 3, orderBy: { createdAt: 'asc' } } },
    });
    if (!user) return [];

    const out: FeedSuggestion[] = [];
    const collections = new Set<string>();
    for (const w of user.watchlists) {
      for (const s of w.collectionSlugs) collections.add(s);
    }

    if (collections.size > 0) {
      const sample = [...collections].slice(0, 3).join(', ');
      out.push({
        title: 'Collection alpha',
        reason: `You track: ${sample} — prioritize sniper_high + cheap_rare recipes for those names.`,
        recipeHint: 'sniper_high',
      });
    }

    out.push({
      title: 'Beautiful serials',
      reason: 'Pattern listings (palindrome, 777, low ID) — recipe `beautiful_serial`.',
      recipeHint: 'beautiful_serial',
    });

    out.push({
      title: 'Cross-market arb',
      reason: 'When Tonnel/Portals go live, add recipe `arbitrage` channel for spread alerts.',
      recipeHint: 'arbitrage',
    });

    const crit = user.filters[0]?.criteria;
    const markets =
      crit && typeof crit === 'object' && 'markets' in crit && Array.isArray((crit as { markets?: unknown }).markets)
        ? ((crit as { markets: string[] }).markets ?? []).join(', ')
        : 'mrkt';
    out.push({
      title: 'Market coverage',
      reason: `Your filters target: ${markets}. Add the same markets to collectors for whale + arb signals.`,
      recipeHint: 'whale_activity',
    });

    return out;
  }
}
