import { randomUUID } from "node:crypto";
import Redis from "ioredis";

const script = [
  "local clock = redis.call('TIME')",
  "local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)",
  "local window = tonumber(ARGV[1])",
  "local limit = tonumber(ARGV[2])",
  "redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)",
  "local count = redis.call('ZCARD', KEYS[1])",
  "local allowed = 0",
  "if count < limit then",
  "  redis.call('ZADD', KEYS[1], now, ARGV[3])",
  "  count = count + 1",
  "  allowed = 1",
  "  redis.call('PEXPIRE', KEYS[1], window)",
  "end",
  "local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')",
  "local reset = window",
  "if #oldest > 0 then reset = math.max(1, tonumber(oldest[2]) + window - now) end",
  "return {allowed, math.max(0, limit - count), math.ceil(reset / 1000)}",
].join("\n");

export async function checkLimit(redis: Redis, key: string, limit: number, windowMs = 60000) {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1) {
    throw new Error("Limit and window must be positive integers");
  }
  if (!("checkSlidingWindow" in redis)) {
    redis.defineCommand("checkSlidingWindow", { numberOfKeys: 1, lua: script });
  }
  const client = redis as Redis & {
    checkSlidingWindow(key: string, window: number, limit: number, id: string): Promise<number[]>;
  };
  const [allowed, remaining, resetInSeconds] = await client.checkSlidingWindow(
    key,
    windowMs,
    limit,
    randomUUID(),
  );
  return { allowed: allowed === 1, remaining, resetInSeconds };
}
