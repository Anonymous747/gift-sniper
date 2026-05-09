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
  /** Mini App tab: листинг / продажа / сдано в аренду (rent не матчится до появления событий). */
  alertTab?: 'listing' | 'sale' | 'rent';
  /** Match listings for this serial only when set. */
  giftSerial?: number;
}

export function parseCriteriaJson(raw: unknown): FilterCriteria {
  if (!raw || typeof raw !== 'object') return {};
  return raw as FilterCriteria;
}
