import { Module } from '@nestjs/common';
import { StreamConsumerService } from './stream-consumer.service';
import { EventsModule } from '../events/events.module';
import { IngestionModule } from '../ingestion/ingestion.module';

@Module({
  imports: [EventsModule, IngestionModule],
  providers: [StreamConsumerService],
})
export class PipelineModule {}
