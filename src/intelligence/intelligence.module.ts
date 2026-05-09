import { Module } from '@nestjs/common';
import { CollectionAnalyticsService } from './collection-analytics.service';
import { WhaleTrackingService } from './whale-tracking.service';

@Module({
  providers: [WhaleTrackingService, CollectionAnalyticsService],
  exports: [WhaleTrackingService, CollectionAnalyticsService],
})
export class IntelligenceModule {}
