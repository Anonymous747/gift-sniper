import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [IngestionModule, EventsModule],
  controllers: [AdminController],
})
export class AdminModule {}
