import { Module } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { AlertsModule } from '../alerts/alerts.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [AlertsModule, RealtimeModule],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
