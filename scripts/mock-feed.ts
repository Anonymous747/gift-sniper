/**
 * Push a single normalized listing onto the Redis stream (for local testing without running collectors).
 * Usage: REDIS_URL=redis://localhost:6379 npx ts-node scripts/mock-feed.ts
 */
import Redis from 'ioredis';
import { randomInt } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const streamKey = process.env.EVENT_STREAM_KEY ?? 'gifts:events:v1';

async function main() {
  const redis = new Redis(redisUrl);
  const collection = ['Sakura', 'Neon', 'Obsidian'][randomInt(0, 3)]!;
  const serial = randomInt(1, 9999);
  const floor = 5 + randomInt(0, 50) / 10;
  const price = floor * 0.72;
  const event = {
    event_id: uuidv4(),
    market: 'mrkt',
    event_type: 'listing',
    gift_id: `${collection.toLowerCase()}-${serial}`,
    collection,
    gift_name: `${collection} #${serial}`,
    serial_number: serial,
    price_ton: Number(price.toFixed(2)),
    floor_price: Number(floor.toFixed(2)),
    below_floor_percent: Number((((floor - price) / floor) * 100).toFixed(2)),
    rarity_rank: randomInt(1, 400),
    rarity_score: 0.88,
    seller_id: 'manual_feed',
    seller_name: 'mock_feed',
    timestamp: Date.now(),
  };
  const id = await redis.xadd(streamKey, '*', 'payload', JSON.stringify(event));
  console.log('Published', id, event);
  await redis.quit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
