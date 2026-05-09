import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'events';

export type ListingBroadcastPayload = {
  event: import('../events/normalized-event').NormalizedMarketEvent;
  sniperScore: number;
  ingestedAt: number;
};

@Injectable()
export class AppEventBus extends EventEmitter implements OnModuleDestroy {
  private readonly logger = new Logger(AppEventBus.name);

  constructor() {
    super();
    this.setMaxListeners(200);
  }

  onModuleDestroy() {
    this.removeAllListeners();
  }
}
