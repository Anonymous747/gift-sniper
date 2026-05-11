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

function nzLabel(value: string | null | undefined): string {
  const t = value?.trim();
  return t && t.length > 0 ? t : 'n/a';
}

/**
 * Telegram-friendly “gift card” layout (tree lines), for listings — not a sale headline.
 */
export function formatGiftListingTelegramCard(
  event: NormalizedMarketEvent,
  opts: FormatGiftListingCardOpts,
): string {
  const link = opts.giftLineUrl ?? giftTelegramDisplayUrl(event);
  const giftLine =
    link != null
      ? `${event.gift_name} (${link})`
      : `${event.gift_name} (Market link: n/a)`;

  const discount =
    event.below_floor_percent != null && Number.isFinite(event.below_floor_percent)
      ? `${event.below_floor_percent.toFixed(1)}% below floor`
      : 'n/a';
  const rarity =
    event.rarity_rank != null && Number.isFinite(event.rarity_rank) ? `#${event.rarity_rank}` : 'n/a';

  const rows: string[] = [];
  /** MRKT gift “series” (filter `collectionNames`) — Telegram Star Gift lineup, distinct from Traits. */
  rows.push(`Gift series: ${nzLabel(event.collection)}`);
  rows.push(`Model: ${nzLabel(event.gift_model)}`);
  rows.push(`Symbol: ${nzLabel(event.gift_symbol)}`);
  rows.push(`Backdrop: ${nzLabel(event.gift_backdrop)}`);

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
  rows.push(`Sniper score: ${sn != null && Number.isFinite(sn) ? sn.toFixed(2) : 'n/a'}`);

  if (event.market === 'mrkt') {
    const mrktUrl = mrktTelegramGiftUrl(event);
    rows.push(`Listed on MRKT (${mrktUrl ?? 'n/a'})`);
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
