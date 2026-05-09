import type { NormalizedMarketEvent } from './normalized-event';
import { analyzeSerial } from '../lib/beautiful-serial';

/**
 * Phase-1+ score: higher = more interesting for sniping.
 * Components: discount vs floor, rarity, serial “beauty”, optional velocity / demand / whale hints.
 */
export function computeSniperScore(event: NormalizedMarketEvent): number {
  const below = event.below_floor_percent ?? 0;
  const rarity =
    event.rarity_rank != null ? Math.max(0, 500 - Math.min(500, event.rarity_rank)) / 25 : 0;
  const rarityScore = event.rarity_score != null ? event.rarity_score * 10 : 0;
  const serial = analyzeSerial(event.serial_number).bonus;
  let velocity = 0;
  if (event.velocity === 'high') velocity += 4;
  if (event.velocity === 'spike') velocity += 6;

  const demand =
    event.collection_demand_score != null && Number.isFinite(event.collection_demand_score)
      ? Math.min(10, Math.max(0, event.collection_demand_score))
      : 0;
  const whale =
    event.whale_activity_score != null && Number.isFinite(event.whale_activity_score)
      ? Math.min(12, Math.max(0, event.whale_activity_score))
      : 0;

  return Number((below + rarity + rarityScore + serial + velocity + demand + whale).toFixed(4));
}
