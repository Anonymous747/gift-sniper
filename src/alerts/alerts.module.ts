import { Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { FiltersModule } from '../filters/filters.module';
import { BotModule } from '../bot/bot.module';

@Module({
  imports: [FiltersModule, BotModule],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
