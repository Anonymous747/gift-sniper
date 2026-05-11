export type ExternalListing = {
  gift_id: string;
  collection: string;
  collection_slug?: string;
  nft_telegram_suffix?: string;
  collection_display?: string;
  gift_name: string;
  gift_model?: string | null;
  gift_backdrop?: string | null;
  gift_symbol?: string | null;
  serial_number?: number | null;
  price_ton: number;
  /** `floorPriceNanoTONsByCollection` — gift-series floor. */
  floor_price_collection?: number | null;
  /** `floorPriceNanoTONsByBackdropModel` — model+backdrop floor MRKT shows as “model floor”. */
  floor_price_backdrop_model?: number | null;
  /** Discount baseline: collection floor, else backdrop/model floor (backward compat). */
  floor_price?: number | null;
  seller_id?: string | null;
  seller_name?: string | null;
  rarity_rank?: number | null;
  rarity_score?: number | null;
};

export type FeedResponse = { listings: ExternalListing[] } | ExternalListing[];
