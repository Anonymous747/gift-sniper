import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { MetricsService } from '../metrics/metrics.service';
import type { NormalizedMarketEvent } from './normalized-event';

const CONSUMER_GROUP = 'gift-pipeline';

@Injectable()
export class EventStreamService {
  private readonly logger = new Logger(EventStreamService.name);
  private readonly streamKey: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    this.streamKey = config.getOrThrow<string>('EVENT_STREAM_KEY');
  }

  getStreamKey(): string {
    return this.streamKey;
  }

  getConsumerGroup(): string {
    return CONSUMER_GROUP;
  }

  async ensureGroup(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', this.streamKey, CONSUMER_GROUP, '0', 'MKSTREAM');
      this.logger.log(`Created consumer group ${CONSUMER_GROUP} on ${this.streamKey}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('BUSYGROUP')) {
        return;
      }
      throw err;
    }
  }

  async publish(event: NormalizedMarketEvent): Promise<string> {
    const t0 = Date.now();
    const id = await this.redis.xadd(
      this.streamKey,
      '*',
      'payload',
      JSON.stringify(event),
    );
    this.metrics.recordPublish(Date.now() - t0);
    return id as string;
  }
}
