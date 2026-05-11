import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { PricingModule } from '../pricing/pricing.module';
import { MrktLinkModule } from '../mrkt-link/mrkt-link.module';
import { IntelFeedsDispatcherService } from './intel-feeds-dispatcher.service';

@Module({
  imports: [BotModule, PricingModule, MrktLinkModule],
  providers: [IntelFeedsDispatcherService],
  exports: [IntelFeedsDispatcherService],
})
export class FeedsModule {}
