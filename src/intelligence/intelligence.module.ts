import { Module } from '@nestjs/common';
import { CollectionAnalyticsService } from './collection-analytics.service';
import { WhaleTrackingService } from './whale-tracking.service';
import { ArbitrageEngineService } from './arbitrage-engine.service';
import { RecommendationEngineService } from './recommendation-engine.service';

@Module({
  providers: [
    WhaleTrackingService,
    CollectionAnalyticsService,
    ArbitrageEngineService,
    RecommendationEngineService,
  ],
  exports: [
    WhaleTrackingService,
    CollectionAnalyticsService,
    ArbitrageEngineService,
    RecommendationEngineService,
  ],
})
export class IntelligenceModule {}
