import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, test } from "node:test";
import type { Express } from "express";

const prefix = "test:" + randomUUID() + ":";
let baseUrl: string;
let server: Server;
let redis: (typeof import("./app.js"))["redis"];

before(async () => {
  process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15";

  process.env.RATE_LIMIT_PREFIX = prefix;
  const appModule = await import("./app.js");
  const app = appModule.default as unknown as Express;
  redis = appModule.redis;

  redis.on("error", () => {});
  await redis.ping();

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  const keys = await redis.keys(prefix + "*");
  if (keys.length) await redis.del(...keys);
});

afterEach(async () => {
  const keys = await redis.keys(prefix + "*");
  if (keys.length) await redis.del(...keys);
});

after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  if (redis?.status === "ready") await redis.quit();
  else redis?.disconnect();
});

test("rejects an invalid API key", async () => {
  const response = await fetch(baseUrl, {
    headers: { "x-api-key": "invalid-key" },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    message: "Invalid or missing API key",
  });
  assert.equal((await redis.keys(prefix + "*")).length, 0);
});

test("accepts a valid API key", async () => {
  const response = await fetch(baseUrl, {
    headers: { "x-api-key": "12345-abcde" },
  });
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.message, "Welcome! Your API key allows 5 requests per minute.");
  assert.equal(body.remainingRequests, 4);
  assert.equal(body.resetInSeconds, 60);
  assert.equal((await redis.keys(prefix + "*")).length, 1);
});

test("blocks requests over the API key limit", async () => {
  const headers = { "x-api-key": "12345-abcde" };

  for (let requestNumber = 1; requestNumber <= 5; requestNumber += 1) {
    const response = await fetch(baseUrl, { headers });
    assert.equal(response.status, 200);

    // Redis uses the millisecond timestamp as the sorted-set member.
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  const response = await fetch(baseUrl, { headers });

  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    message: "Too many requests. Please wait before sending another request.",
    remainingRequests: 0,
    resetInSeconds: 60,
  });
});

test("allows exactly five of 100 simultaneous Free requests", async () => {
  const responses = await Promise.all(
    Array.from({ length: 100 }, () => fetch(baseUrl, { headers: { "x-api-key": "12345-abcde" } })),
  );
  assert.equal(responses.filter((r) => r.status === 200).length, 5);
  assert.equal(responses.filter((r) => r.status === 429).length, 95);
  const blocked = responses.find((r) => r.status === 429)!;
  assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
});

test("expires counters and restores quota", async () => {
  const { checkLimit } = await import("./limiter.js");
  assert.equal((await checkLimit(redis, prefix + "expiry-test", 1, 100)).allowed, true);
  assert.equal((await checkLimit(redis, prefix + "expiry-test", 1, 100)).allowed, false);
  assert.ok((await redis.pttl(prefix + "expiry-test")) > 0);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(await redis.exists(prefix + "expiry-test"), 0);
  assert.equal((await checkLimit(redis, prefix + "expiry-test", 1, 100)).allowed, true);
});

test("isolates tier quotas", async () => {
  for (const [apiKey, limit] of [
    ["12345-abcde", 5],
    ["67890-fghij", 20],
    ["admin-key-000", 100],
  ] as const) {
    const responses = await Promise.all(
      Array.from({ length: limit + 10 }, () =>
        fetch(baseUrl, { headers: { "x-api-key": apiKey } }),
      ),
    );
    assert.equal(responses.filter((r) => r.status === 200).length, limit);
    assert.equal(responses.filter((r) => r.status === 429).length, 10);
  }
});

test("serves the dashboard without consuming quota", async () => {
  const response = await fetch(baseUrl + "/demo/");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Every request/);
  assert.equal((await redis.keys(prefix + "*")).length, 0);
});

test("rejects object prototype names as API keys", async () => {
  for (const key of ["__proto__", "constructor", "toString"]) {
    const response = await fetch(baseUrl, { headers: { "x-api-key": key } });
    assert.equal(response.status, 401);
  }
});

test("removes only expired requests from a sliding window", async () => {
  const { checkLimit } = await import("./limiter.js");
  const key = prefix + "rolling";
  const clock = await redis.time();
  const now = Number(clock[0]) * 1000 + Math.floor(Number(clock[1]) / 1000);
  await redis.zadd(key, now - 61000, "expired", now, "recent");
  const result = await checkLimit(redis, key, 2);
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 0);
  assert.equal(await redis.zcard(key), 2);
  assert.equal(await redis.zscore(key, "expired"), null);
});

test("creates hashed keys, enforces their tier, and revokes them", async () => {
  process.env.ADMIN_TOKEN = randomUUID();
  const headers = { "x-admin-token": process.env.ADMIN_TOKEN, "content-type": "application/json" };
  try {
    assert.equal((await fetch(baseUrl + "/admin/keys", { method: "POST" })).status, 401);
    assert.equal(
      (
        await fetch(baseUrl + "/admin/keys", {
          method: "POST",
          headers,
          body: JSON.stringify({ name: "Test", tier: "unknown" }),
        })
      ).status,
      400,
    );
    const created = await fetch(baseUrl + "/admin/keys", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Test", tier: "free" }),
    });
    assert.equal(created.status, 201);
    const { apiKey, keyId } = (await created.json()) as { apiKey: string; keyId: string };
    const stored = await redis.hgetall(prefix + "key:" + keyId);
    assert.equal(stored.limit, "5");
    assert.ok(!JSON.stringify(stored).includes(apiKey));
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => fetch(baseUrl, { headers: { "x-api-key": apiKey } })),
    );
    assert.equal(responses.filter((r) => r.status === 200).length, 5);
    assert.equal(responses.filter((r) => r.status === 429).length, 5);
    assert.equal(
      (await fetch(baseUrl + "/admin/keys/" + keyId, { method: "DELETE", headers })).status,
      204,
    );
    assert.equal((await fetch(baseUrl, { headers: { "x-api-key": apiKey } })).status, 401);
  } finally {
    delete process.env.ADMIN_TOKEN;
  }
});

test("shares one quota across two independent backend processes", async () => {
  const { spawn } = await import("node:child_process");
  const children: ReturnType<typeof spawn>[] = [];
  const startBackend = async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: "0", HOST: "127.0.0.1", ENABLE_DEMO_KEYS: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Backend startup timed out")), 10000);
      let output = "";
      child.stdout!.on("data", (chunk) => {
        output += String(chunk);
        const match = output.match(/Server running at http:\/\/localhost:(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve("http://127.0.0.1:" + match[1]);
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Backend exited before ready"));
      });
    });
  };
  try {
    const urls = await Promise.all([startBackend(), startBackend()]);
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        fetch(urls[i % 2], { headers: { "x-api-key": "12345-abcde" } }),
      ),
    );
    assert.equal(responses.filter((r) => r.status === 200).length, 5);
    assert.equal(responses.filter((r) => r.status === 429).length, 5);
  } finally {
    await Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null) {
              resolve();
              return;
            }
            child.once("exit", () => resolve());
            child.kill();
          }),
      ),
    );
  }
});
