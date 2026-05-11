import type { NormalizedMarketEvent } from '../events/normalized-event';
import { giftTelegramDisplayUrl, mrktTelegramGiftUrl } from './mrkt-telegram-link';

export type FormatGiftListingCardOpts = {
  headline: string;
  subhead?: string | null;
  /** When set (positive finite), append ` (~$…)` to the TON price. */
  tonUsdRate?: number | null;
  sniperScore?: number | null;
  /**
   * Primary URL on the 🏷 line (catalog-validated `t.me/nft` or MRKT mini-app).
   * When omitted, uses sync `giftTelegramDisplayUrl` (MRKT → mini-app only).
   */
  giftLineUrl?: string | null;
};

function tonDisplay(ton: number | null | undefined): string {
  if (ton == null || !Number.isFinite(ton)) return '?';
  return ton.toFixed(1);
}

/**
 * MRKT `collectionName` / filter `collectionNames` are **Telegram gift series names**
 * (Obsidian, Sakura, …), i.e. the same tier as `t.me/nft/Obsidian-8090` — not a separate
 * Fragment “collection” taxonomy. Only show a footer line when it adds info beyond `gift_name`.
 */
export function giftSeriesFooterExtraLine(event: NormalizedMarketEvent): string | null {
  const series = event.collection?.trim();
  if (!series) return null;
  const gift = event.gift_name?.trim() ?? '';
  if (gift.length > 0 && gift.toLowerCase().startsWith(series.toLowerCase())) {
    return null;
  }
  return `Gift series: ${series}`;
}

/**
 * Telegram-friendly “gift card” layout (tree lines), for listings — not a sale headline.
 */
export function formatGiftListingTelegramCard(
  event: NormalizedMarketEvent,
  opts: FormatGiftListingCardOpts,
): string {
  const link = opts.giftLineUrl ?? giftTelegramDisplayUrl(event);
  const giftLine = link != null ? `${event.gift_name} (${link})` : event.gift_name;

  const discount =
    event.below_floor_percent != null && Number.isFinite(event.below_floor_percent)
      ? `${event.below_floor_percent.toFixed(1)}% below floor`
      : 'n/a';
  const rarity =
    event.rarity_rank != null && Number.isFinite(event.rarity_rank) ? `#${event.rarity_rank}` : 'n/a';

  const rows: string[] = [];
  const model = event.gift_model?.trim();
  if (model) rows.push(`Model: ${model}`);
  const symbol = event.gift_symbol?.trim();
  if (symbol) rows.push(`Symbol: ${symbol}`);
  const backdrop = event.gift_backdrop?.trim();
  if (backdrop) rows.push(`Backdrop: ${backdrop}`);

  const ton = event.price_ton;
  let priceLine = `Price: ${tonDisplay(ton)} TON`;
  const rate = opts.tonUsdRate;
  if (ton != null && Number.isFinite(ton) && rate != null && Number.isFinite(rate) && rate > 0) {
    priceLine += ` (~$${(ton * rate).toFixed(1)})`;
  }
  rows.push(priceLine);

  rows.push(`Floor: ${tonDisplay(event.floor_price)} TON`);
  rows.push(`Discount: ${discount}`);
  rows.push(`Rarity rank: ${rarity}`);

  const sn = opts.sniperScore;
  if (sn != null && Number.isFinite(sn)) {
    rows.push(`Sniper score: ${sn.toFixed(2)}`);
  }

  if (event.market === 'mrkt') {
    const mrktUrl = mrktTelegramGiftUrl(event);
    if (mrktUrl) {
      rows.push(`Listed on MRKT (${mrktUrl})`);
    } else {
      rows.push('Listed on MRKT');
    }
  } else {
    rows.push(`Market: ${event.market.toUpperCase()}`);
  }

  const tree = rows.map((line, i) => (i < rows.length - 1 ? `├ ${line}` : `└ ${line}`));

  const head: string[] = [opts.headline.trim()];
  const sub = opts.subhead?.trim();
  if (sub) head.push(sub);
  head.push('', `🏷 ${giftLine}`, ...tree);

  return head.join('\n');
}
