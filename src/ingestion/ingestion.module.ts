import { Module } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { AlertsModule } from '../alerts/alerts.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { FeedsModule } from '../feeds/feeds.module';

@Module({
  imports: [AlertsModule, RealtimeModule, IntelligenceModule, FeedsModule],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
