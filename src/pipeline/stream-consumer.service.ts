import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { EventStreamService } from '../events/event-stream.service';
import { IngestionService } from '../ingestion/ingestion.service';

@Injectable()
export class StreamConsumerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(StreamConsumerService.name);
  private stop = false;
  private readonly consumerName: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly streams: EventStreamService,
    private readonly ingestion: IngestionService,
    config: ConfigService,
  ) {
    this.consumerName = `api-${process.pid}`;
  }

  async onApplicationBootstrap() {
    await this.streams.ensureGroup();
    void this.loop();
  }

  onModuleDestroy() {
    this.stop = true;
  }

  private async loop(): Promise<void> {
    const key = this.streams.getStreamKey();
    const group = this.streams.getConsumerGroup();
    while (!this.stop) {
      try {
        const res = (await this.redis.xreadgroup(
          'GROUP',
          group,
          this.consumerName,
          'COUNT',
          '50',
          'BLOCK',
          '2500',
          'STREAMS',
          key,
          '>',
        )) as [string, [string, string[]][]][] | null;

        if (!res || res.length === 0) continue;
        for (const [, messages] of res) {
          for (const [id, fields] of messages) {
            await this.handleMessage(id, fields, key, group);
          }
        }
      } catch (err) {
        this.logger.error(`Stream read error: ${err instanceof Error ? err.message : err}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async handleMessage(
    id: string,
    fields: string[],
    key: string,
    group: string,
  ): Promise<void> {
    const payloadIdx = fields.indexOf('payload');
    if (payloadIdx === -1 || !fields[payloadIdx + 1]) {
      await this.redis.xack(key, group, id);
      return;
    }
    const raw = fields[payloadIdx + 1];
    try {
      const parsed = JSON.parse(raw) as unknown;
      await this.ingestion.handleNormalizedEvent(parsed);
    } catch (err) {
      this.logger.warn(`Bad stream payload: ${err instanceof Error ? err.message : err}`);
    } finally {
      await this.redis.xack(key, group, id);
    }
  }
}
