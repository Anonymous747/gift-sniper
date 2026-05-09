import type { NormalizedMarketEvent } from './normalized-event';

const DESIRABLE_SERIALS = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 22, 33, 44, 55, 66, 69, 77, 88, 99, 100, 111, 123, 222, 333, 420, 666, 777, 888, 999, 1000,
]);

function isPalindrome(n: number): boolean {
  const s = String(n);
  return s === s.split('').reverse().join('');
}

function repeatingDigitBonus(n: number): number {
  const s = String(n);
  if (s.length < 2) return 0;
  const first = s[0];
  if (s.split('').every((c) => c === first)) return 4;
  return 0;
}

export function serialDesirability(serial: number | null): number {
  if (serial == null) return 0;
  if (DESIRABLE_SERIALS.has(serial)) return 8;
  if (serial <= 10) return 6;
  if (serial <= 99 && serial % 10 === serial % 100) return 2;
  if (isPalindrome(serial)) return 3;
  return repeatingDigitBonus(serial);
}

/**
 * Phase-1 score: higher = more interesting for sniping.
 * Components: discount vs floor, rarity, serial pattern, optional velocity hint.
 */
export function computeSniperScore(event: NormalizedMarketEvent): number {
  const below = event.below_floor_percent ?? 0;
  const rarity =
    event.rarity_rank != null ? Math.max(0, 500 - Math.min(500, event.rarity_rank)) / 25 : 0;
  const rarityScore = event.rarity_score != null ? event.rarity_score * 10 : 0;
  const serial = serialDesirability(event.serial_number);
  let velocity = 0;
  if (event.velocity === 'high') velocity += 4;
  if (event.velocity === 'spike') velocity += 6;
  return Number((below + rarity + rarityScore + serial + velocity).toFixed(4));
}
