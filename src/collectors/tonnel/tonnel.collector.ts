import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Placeholder for Tonnel market ingestion. Architecture matches `mrkt/` — add API client + mapper here.
 */
@Injectable()
export class TonnelCollector implements OnModuleInit {
  private readonly logger = new Logger(TonnelCollector.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    if (this.config.get<string>('TONNEL_ENABLED') === '1') {
      this.logger.warn('Tonnel collector stub: set TONNEL_* API env vars and implement poll → normalize → publish.');
    }
  }
}
