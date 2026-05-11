import { Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { FiltersModule } from '../filters/filters.module';
import { BotModule } from '../bot/bot.module';
import { PricingModule } from '../pricing/pricing.module';
import { MrktLinkModule } from '../mrkt-link/mrkt-link.module';

@Module({
  imports: [FiltersModule, BotModule, PricingModule, MrktLinkModule],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
