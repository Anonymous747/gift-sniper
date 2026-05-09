import { Module } from '@nestjs/common';
import { AppEventBus } from './app-event-bus';
import { EventsGateway } from './events.gateway';

@Module({
  providers: [AppEventBus, EventsGateway],
  exports: [AppEventBus],
})
export class RealtimeModule {}
