export type ExternalListing = {
  gift_id: string;
  collection: string;
  collection_slug?: string;
  nft_telegram_suffix?: string;
  collection_display?: string;
  gift_name: string;
  gift_model?: string | null;
  serial_number?: number | null;
  price_ton: number;
  floor_price?: number | null;
  seller_id?: string | null;
  seller_name?: string | null;
  rarity_rank?: number | null;
  rarity_score?: number | null;
};

export type FeedResponse = { listings: ExternalListing[] } | ExternalListing[];
