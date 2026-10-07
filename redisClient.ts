import Redis from "ioredis";

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  connectTimeout: 3000,
  maxRetriesPerRequest: 1,
  retryStrategy: (attempt) => (attempt <= 10 ? Math.min(attempt * 100, 1000) : null),
});
