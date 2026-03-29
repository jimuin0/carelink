import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

function createRedis(): Redis | undefined {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return undefined;
  }
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

const redis = createRedis();

export const bookingRateLimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, '5 m'), prefix: 'rl:booking' })
  : null;

export const notifyRateLimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '60 s'), prefix: 'rl:notify' })
  : null;

export const mutationRateLimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '60 s'), prefix: 'rl:mutation' })
  : null;

// in-memory fallback (Upstash未設定時)
const store = new Map<string, number[]>();

export function inMemoryRateLimit(ip: string, limit: number, windowMs: number, prefix: string): boolean {
  const key = `${prefix}:${ip}`;
  const now = Date.now();
  const timestamps = (store.get(key) || []).filter(t => now - t < windowMs);
  if (timestamps.length >= limit) return true;
  timestamps.push(now);
  store.set(key, timestamps);
  if (store.size > 1000) {
    Array.from(store.entries()).forEach(([k, ts]) => {
      if (ts.every((t: number) => now - t >= windowMs)) store.delete(k);
    });
  }
  return false;
}

export async function checkRateLimit(
  limiter: Ratelimit | null,
  ip: string,
  fallbackLimit: number,
  fallbackWindowMs: number,
  prefix: string,
): Promise<boolean> {
  if (limiter) {
    const { success } = await limiter.limit(ip);
    return !success;
  }
  return inMemoryRateLimit(ip, fallbackLimit, fallbackWindowMs, prefix);
}
