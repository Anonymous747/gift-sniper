export interface FilterCriteria {
  minPriceTon?: number;
  maxPriceTon?: number;
  belowFloorPercentMin?: number;
  belowFloorPercentMax?: number;
  markets?: string[];
  collectionsInclude?: string[];
  collectionsExclude?: string[];
  minSniperScore?: number;
  maxRarityRank?: number;
  /** Mini App: `listing` vs `Продажа` tab grouping (sale alerts not wired in AlertsService yet). */
  alertTab?: 'listing' | 'sale';
  /** Match listings for this serial only when set. */
  giftSerial?: number;
}

export function parseCriteriaJson(raw: unknown): FilterCriteria {
  if (!raw || typeof raw !== 'object') return {};
  return raw as FilterCriteria;
}
