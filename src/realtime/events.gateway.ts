import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import type { ListingBroadcastPayload } from './app-event-bus';
import { AppEventBus } from './app-event-bus';

@WebSocketGateway({
  cors: { origin: true },
  transports: ['websocket', 'polling'],
})
export class EventsGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: Server;

  private readonly onListing = (payload: ListingBroadcastPayload) => {
    try {
      this.server?.emit('listing', payload);
    } catch (err) {
      this.logger.warn(`WS emit failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  constructor(private readonly bus: AppEventBus) {}

  onModuleInit() {
    this.bus.on('listing', this.onListing);
  }

  onModuleDestroy() {
    this.bus.off('listing', this.onListing);
  }
}
