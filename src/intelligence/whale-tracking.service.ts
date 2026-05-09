import { Injectable } from '@nestjs/common';

/**
 * Future: wallet profiling, PnL, favorite collections, `smart_money_score`, on-chain / MRKT seller graphs.
 */
@Injectable()
export class WhaleTrackingService {
  /** Placeholder — returns null until wallet graph ingestion exists. */
  smartMoneyScore(_address: string): null {
    return null;
  }
}
