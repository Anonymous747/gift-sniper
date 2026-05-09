export type MarketSlug = 'mrkt' | 'tonnel' | 'portals';

export type NormalizedEventType =
  | 'listing'
  | 'sale'
  | 'floor_update'
  | 'delisting'
  | 'ownership_change';

export interface NormalizedMarketEvent {
  event_id: string;
  market: MarketSlug;
  event_type: NormalizedEventType;
  gift_id: string;
  collection: string;
  collection_display?: string;
  gift_name: string;
  serial_number: number | null;
  price_ton: number | null;
  floor_price: number | null;
  below_floor_percent: number | null;
  rarity_rank: number | null;
  rarity_score: number | null;
  seller_id: string | null;
  seller_name: string | null;
  timestamp: number;
  velocity?: string | null;
  liquidity_score?: string | null;
}

export function assertNormalizedEvent(raw: unknown): NormalizedMarketEvent {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid event: not an object');
  }
  const e = raw as Record<string, unknown>;
  const required = [
    'event_id',
    'market',
    'event_type',
    'gift_id',
    'collection',
    'gift_name',
    'timestamp',
  ] as const;
  for (const k of required) {
    if (e[k] === undefined || e[k] === null) {
      throw new Error(`Invalid event: missing ${k}`);
    }
  }
  return e as unknown as NormalizedMarketEvent;
}
