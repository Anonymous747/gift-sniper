import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { IntelFeedsDispatcherService } from './intel-feeds-dispatcher.service';

@Module({
  imports: [BotModule],
  providers: [IntelFeedsDispatcherService],
  exports: [IntelFeedsDispatcherService],
})
export class FeedsModule {}
