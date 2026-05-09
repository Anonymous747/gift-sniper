/** Injection token for ioredis client (avoid importing from `redis.module` — circular with `RedisService`). */
export const REDIS_CLIENT = 'REDIS_CLIENT';
