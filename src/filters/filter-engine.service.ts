import { Injectable } from '@nestjs/common';
import type { NormalizedMarketEvent } from '../events/normalized-event';
import type { FilterCriteria } from './filter-criteria';

@Injectable()
export class FilterEngineService {
  matches(criteria: FilterCriteria, event: NormalizedMarketEvent): boolean {
    const tab = criteria.alertTab ?? 'listing';
    if (tab === 'listing' && event.event_type !== 'listing') return false;
    if (tab === 'sale' && event.event_type !== 'sale') return false;

    if (criteria.giftSerial != null) {
      if (event.serial_number == null || event.serial_number !== criteria.giftSerial) return false;
    }
    if (criteria.markets?.length && !criteria.markets.includes(event.market)) {
      return false;
    }
    if (event.price_ton != null) {
      if (criteria.minPriceTon != null && event.price_ton < criteria.minPriceTon) return false;
      if (criteria.maxPriceTon != null && event.price_ton > criteria.maxPriceTon) return false;
    }
    const below = event.below_floor_percent;
    if (criteria.belowFloorPercentMin != null) {
      if (below == null || below < criteria.belowFloorPercentMin) return false;
    }
    if (criteria.belowFloorPercentMax != null) {
      if (below == null || below > criteria.belowFloorPercentMax) return false;
    }
    const coll = event.collection.toLowerCase();
    if (criteria.collectionsInclude?.length) {
      const set = new Set(criteria.collectionsInclude.map((c) => c.toLowerCase()));
      if (!set.has(coll)) return false;
    }
    if (criteria.collectionsExclude?.length) {
      const set = new Set(criteria.collectionsExclude.map((c) => c.toLowerCase()));
      if (set.has(coll)) return false;
    }
    if (criteria.maxRarityRank != null && event.rarity_rank != null) {
      if (event.rarity_rank > criteria.maxRarityRank) return false;
    }
    return true;
  }
}
