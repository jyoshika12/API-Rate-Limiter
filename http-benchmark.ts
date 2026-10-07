import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { cpus, totalmem } from "node:os";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import apiKeys from "./apiKeys.js";

async function main() {
  const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 50);
  const requests = Number(process.env.BENCH_REQUESTS ?? 10000);
  const mode = process.env.BENCH_MODE ?? "allowed";
  if (
    ![concurrency, requests].every((n) => Number.isInteger(n) && n > 0) ||
    !["allowed", "blocked"].includes(mode)
  )
    throw new Error("Invalid benchmark settings");
  const apiKey = "benchmark-" + randomUUID();
  apiKeys[apiKey] = {
    name: "Temporary benchmark user",
    limit: mode === "allowed" ? requests + 201 : 1,
  };
  const { default: app, redis } = await import("./app.js");
  redis.on("error", () => {});
  let server: Server | undefined;
  const key = (process.env.RATE_LIMIT_PREFIX ?? "rate-limit:") + apiKey + ":127.0.0.1";
  try {
    await redis.ping();
    const info = await redis.info("server");
    server = (app as unknown as Express).listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const url = "http://127.0.0.1:" + (server!.address() as AddressInfo).port;
    const options = { headers: { "x-api-key": apiKey } };
    for (let i = 0; i < 200; i++) {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
      await response.text();
    }
    await redis.del(key);
    if (mode === "blocked") {
      const response = await fetch(url, options);
      await response.text();
    }
    const timings: number[] = [];
    let next = 0,
      allowed = 0,
      blocked = 0,
      errors = 0;
    const start = performance.now();
    await Promise.all(
      Array.from({ length: Math.min(concurrency, requests) }, async () => {
        while (next < requests) {
          next++;
          const started = performance.now();
          try {
            const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
            await response.text();
            if (response.status === 200) allowed++;
            else if (response.status === 429) blocked++;
            else errors++;
          } catch {
            errors++;
          }
          timings.push(performance.now() - started);
        }
      }),
    );
    const seconds = (performance.now() - start) / 1000;
    timings.sort((a, b) => a - b);
    const percentile = (p: number) => Number(timings[Math.ceil(p * requests) - 1].toFixed(3));
    const result = {
      date: new Date().toISOString(),
      scope:
        "Local HTTP round trip including authentication, Redis check and response body; excludes frontend",
      mode,
      requests,
      concurrency,
      allowed,
      blocked,
      errors,
      requestsPerSecond: Math.round(requests / seconds),
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      environment: {
        node: process.version,
        platform: process.platform,
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        memoryGiB: Number((totalmem() / 2 ** 30).toFixed(1)),
        redis: info.match(/redis_version:(.*)/)?.[1].trim(),
      },
    };
    console.log(JSON.stringify(result, null, 2));
    if (process.env.BENCH_OUTPUT)
      await writeFile(process.env.BENCH_OUTPUT, JSON.stringify(result, null, 2) + "\n");
    if (
      errors ||
      (mode === "allowed" && allowed !== requests) ||
      (mode === "blocked" && blocked !== requests)
    )
      process.exitCode = 1;
  } finally {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    delete apiKeys[apiKey];
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
