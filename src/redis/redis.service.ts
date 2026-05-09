import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.module';

@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) public readonly client: Redis) {}

  async dedupeOnce(key: string, ttlSec: number): Promise<boolean> {
    const res = await this.client.set(key, '1', 'EX', ttlSec, 'NX');
    return res === 'OK';
  }
}
