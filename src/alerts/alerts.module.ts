import { Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { FiltersModule } from '../filters/filters.module';
import { BotModule } from '../bot/bot.module';
import { PricingModule } from '../pricing/pricing.module';

@Module({
  imports: [FiltersModule, BotModule, PricingModule],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
