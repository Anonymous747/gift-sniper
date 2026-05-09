import { Controller, Get, Headers } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { validateTelegramWebAppInitData } from '../lib/telegram-webapp';
import { mrktTelegramGiftUrl } from '../lib/mrkt-telegram-link';
import type { NormalizedMarketEvent } from '../events/normalized-event';

@Controller('mini')
export class MiniAppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  shell(): string {
    const base = (this.config.get<string>('PUBLIC_APP_BASE_URL') ?? '').replace(/\/$/, '');
    const apiPrefix = base ? `${base}` : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <title>Gift Sniper</title>
  <style>
    :root { color-scheme: dark; }
    body { margin:0; font-family: system-ui, sans-serif; background:#0b0f14; color:#e8edf4; min-height:100vh; }
    header { padding:14px 16px; border-bottom:1px solid #1c2530; font-weight:600; letter-spacing:.02em; }
    main { padding:12px 16px 32px; }
    .card { background:#121a24; border:1px solid #1c2530; border-radius:12px; padding:12px; margin-bottom:10px; }
    .muted { color:#7a8aa0; font-size:13px; }
    .price { color:#5eead4; font-weight:600; }
    a { color:#7dd3fc; }
    #err { color:#fca5a5; font-size:14px; margin-bottom:12px; }
  </style>
</head>
<body>
  <header>⚡ Gift Sniper</header>
  <main>
    <p class="muted">Realtime listings (MRKT deep links when serial known).</p>
    <div id="err"></div>
    <div id="list"></div>
  </main>
  <script>
    (function () {
      var tg = window.Telegram && window.Telegram.WebApp;
      if (tg) { tg.ready(); tg.expand(); }
      var initData = tg && tg.initData ? tg.initData : '';
      var errEl = document.getElementById('err');
      var listEl = document.getElementById('list');
      var base = ${JSON.stringify(apiPrefix)};
      var url = (base || '') + '/mini/listings';
      fetch(url, { headers: { 'X-Telegram-Init-Data': initData } })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data.ok) { errEl.textContent = data.reason || 'Unauthorized'; return; }
          listEl.innerHTML = (data.listings || []).map(function (x) {
            return '<div class="card"><div>' + escapeHtml(x.title) + '</div><div class="muted">' +
              escapeHtml(x.collection) + ' · ' + escapeHtml(x.market) + '</div><div class="price">' +
              escapeHtml(String(x.priceTon)) + ' TON</div>' +
              (x.link ? '<div><a href="' + escapeAttr(x.link) + '">Open in Telegram</a></div>' : '') + '</div>';
          }).join('') || '<p class="muted">No active listings.</p>';
        })
        .catch(function (e) { errEl.textContent = 'Load failed'; });
      function escapeHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      }
      function escapeAttr(s) {
        return escapeHtml(s).replace(/"/g,'&quot;');
      }
    })();
  </script>
</body>
</html>`;
  }

  @Get('listings')
  async listings(@Headers('x-telegram-init-data') initData: string | undefined) {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN')?.trim();
    if (!token) {
      return { ok: false as const, reason: 'bot_not_configured' };
    }
    const maxAge = Number(this.config.get<string>('TWA_MAX_AUTH_AGE_SEC') ?? 86400);
    const v = validateTelegramWebAppInitData(initData ?? '', token, Number.isFinite(maxAge) ? maxAge : 86400);
    if (!v.ok) {
      return { ok: false as const, reason: v.reason };
    }

    const rows = await this.prisma.giftListing.findMany({
      take: 40,
      where: { active: true },
      orderBy: { listedAt: 'desc' },
      include: {
        gift: { include: { collection: true } },
      },
    });

    const listings = rows.map((r) => {
      const c = r.gift.collection;
      const pseudo: Pick<
        NormalizedMarketEvent,
        'market' | 'gift_id' | 'collection' | 'serial_number'
      > = {
        market: r.marketSlug as NormalizedMarketEvent['market'],
        gift_id: r.gift.externalId,
        collection: c.displayName ?? c.slug,
        serial_number: r.gift.serialNumber,
      };
      const link = mrktTelegramGiftUrl({
        ...pseudo,
        event_id: '',
        event_type: 'listing',
        gift_name: r.gift.name,
        price_ton: Number(r.priceTon),
        floor_price: r.floorTon != null ? Number(r.floorTon) : null,
        below_floor_percent: null,
        rarity_rank: null,
        rarity_score: null,
        seller_id: null,
        seller_name: null,
        timestamp: Date.now(),
      } as NormalizedMarketEvent);
      return {
        id: r.id,
        title: r.gift.name,
        collection: c.displayName ?? c.slug,
        market: r.marketSlug,
        priceTon: Number(r.priceTon),
        sniperScore: r.sniperScore != null ? Number(r.sniperScore) : null,
        link,
      };
    });

    return { ok: true as const, listings };
  }
}
