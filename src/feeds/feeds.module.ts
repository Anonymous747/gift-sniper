import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { PricingModule } from '../pricing/pricing.module';
import { IntelFeedsDispatcherService } from './intel-feeds-dispatcher.service';

@Module({
  imports: [BotModule, PricingModule],
  providers: [IntelFeedsDispatcherService],
  exports: [IntelFeedsDispatcherService],
})
export class FeedsModule {}
