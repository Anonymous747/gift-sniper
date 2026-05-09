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
}

export function parseCriteriaJson(raw: unknown): FilterCriteria {
  if (!raw || typeof raw !== 'object') return {};
  return raw as FilterCriteria;
}
