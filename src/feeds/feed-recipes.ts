import type { NormalizedMarketEvent } from '../events/normalized-event';

/** Routing keys for `IntelFeedChannel.recipe` — many channels, many purposes. */
export type FeedRecipe =
  | 'sniper_high'
  | 'beautiful_serial'
  | 'whale_activity'
  | 'rare_finder'
  | 'fast_flip'
  | 'cheap_rare'
  | 'arbitrage'
  | 'all_listings';

export function parseFeedRecipe(raw: string): FeedRecipe | null {
  const allowed: FeedRecipe[] = [
    'sniper_high',
    'beautiful_serial',
    'whale_activity',
    'rare_finder',
    'fast_flip',
    'cheap_rare',
    'arbitrage',
    'all_listings',
  ];
  return allowed.includes(raw as FeedRecipe) ? (raw as FeedRecipe) : null;
}

export function recipeMatchesListing(
  recipe: FeedRecipe,
  event: NormalizedMarketEvent,
  sniperScore: number,
  minSniperScore: number | null,
): boolean {
  const min = minSniperScore ?? (recipe === 'sniper_high' ? 70 : 0);
  const below = event.below_floor_percent ?? 0;
  const rarityRank = event.rarity_rank;
  const rarityScore = event.rarity_score ?? 0;
  const whale = event.whale_activity_score ?? 0;
  const vel = event.velocity ?? '';

  switch (recipe) {
    case 'all_listings':
      return true;
    case 'sniper_high':
      return sniperScore >= min;
    case 'beautiful_serial':
      return event.beautiful_serial === true;
    case 'whale_activity':
      return whale >= 4 || (event.seller_id != null && whale >= 1);
    case 'rare_finder':
      return (rarityRank != null && rarityRank <= 120) || rarityScore >= 0.35;
    case 'fast_flip':
      return vel === 'high' || vel === 'spike';
    case 'cheap_rare':
      return below >= 20 && ((rarityRank != null && rarityRank <= 250) || rarityScore >= 0.25);
    case 'arbitrage':
      return false;
    default:
      return false;
  }
}
