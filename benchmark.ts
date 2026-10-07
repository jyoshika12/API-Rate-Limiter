import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import Redis from "ioredis";
import { checkLimit } from "./limiter.js";

async function main() {
  const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 50);
  const total = Number(process.env.BENCH_REQUESTS ?? 10000);
  if (![concurrency, total].every((n) => Number.isInteger(n) && n > 0))
    throw new Error("Invalid benchmark settings");
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    retryStrategy: () => null,
    connectTimeout: 3000,
  });
  redis.on("error", () => {});
  const key = "benchmark:" + randomUUID();
  try {
    await redis.connect();
    for (let i = 0; i < 200; i++) await checkLimit(redis, key, total + 1000);
    await redis.del(key);
    const latencies: number[] = [];
    let next = 0;
    let allowed = 0;
    const started = performance.now();
    await Promise.all(
      Array.from({ length: Math.min(concurrency, total) }, async () => {
        while (next < total) {
          next++;
          const start = performance.now();
          const result = await checkLimit(redis, key, total + 1000);
          latencies.push(performance.now() - start);
          if (result.allowed) allowed++;
        }
      }),
    );
    const seconds = (performance.now() - started) / 1000;
    latencies.sort((a, b) => a - b);
    const percentile = (p: number) => Number(latencies[Math.ceil(p * total) - 1].toFixed(3));
    console.log(
      JSON.stringify(
        {
          scope: "Local Redis limiter calls; excludes HTTP, authentication and frontend",
          node: process.version,
          platform: process.platform,
          requests: total,
          concurrency,
          allowed,
          operationsPerSecond: Math.round(total / seconds),
          p50Ms: percentile(0.5),
          p95Ms: percentile(0.95),
          p99Ms: percentile(0.99),
        },
        null,
        2,
      ),
    );
  } finally {
    if (redis.status === "ready") {
      await redis.del(key);
      await redis.quit();
    } else redis.disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
