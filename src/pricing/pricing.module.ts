import { Module } from '@nestjs/common';
import { TonUsdRateService } from './ton-usd-rate.service';

@Module({
  providers: [TonUsdRateService],
  exports: [TonUsdRateService],
})
export class PricingModule {}
