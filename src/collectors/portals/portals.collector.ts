import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Placeholder for Portals market ingestion. Same extension pattern as `mrkt/`.
 */
@Injectable()
export class PortalsCollector implements OnModuleInit {
  private readonly logger = new Logger(PortalsCollector.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    if (this.config.get<string>('PORTALS_ENABLED') === '1') {
      this.logger.warn('Portals collector stub: set PORTALS_* API env vars and implement poll → normalize → publish.');
    }
  }
}
