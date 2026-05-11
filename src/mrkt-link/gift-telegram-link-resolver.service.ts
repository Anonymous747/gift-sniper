import { Injectable } from '@nestjs/common';
import type { NormalizedMarketEvent } from '../events/normalized-event';
import { giftTelegramDisplayUrl, mrktPrimaryListingDisplayUrl } from '../lib/mrkt-telegram-link';

/**
 * Resolves the primary URL for listing cards. MRKT uses strict suffix-vs-series matching
 * (see `mrktPrimaryListingDisplayUrl`); no network I/O.
 */
@Injectable()
export class GiftTelegramLinkResolverService {
  displayUrlForListing(event: NormalizedMarketEvent): string | null {
    if (event.market !== 'mrkt') {
      return giftTelegramDisplayUrl(event);
    }
    return mrktPrimaryListingDisplayUrl(event);
  }
}
