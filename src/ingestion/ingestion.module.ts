import { Module } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [AlertsModule],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
