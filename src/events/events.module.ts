import { Module } from '@nestjs/common';
import { EventStreamService } from './event-stream.service';

@Module({
  providers: [EventStreamService],
  exports: [EventStreamService],
})
export class EventsModule {}
