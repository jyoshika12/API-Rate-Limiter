import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, test } from "node:test";
import type { Express } from "express";

let baseUrl: string;
let server: Server;
let redis: (typeof import("./app.js"))["redis"];

before(async () => {
  process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15";

  const appModule = await import("./app.js");
  const app = appModule.default as unknown as Express;
  redis = appModule.redis;

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
  await redis.flushdb();
});

afterEach(async () => {
  await redis.flushdb();
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await redis.quit();
});

test("rejects an invalid API key", async () => {
  const response = await fetch(baseUrl, {
    headers: { "x-api-key": "invalid-key" },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    message: "Invalid or missing API key",
  });
  assert.equal(await redis.dbsize(), 0);
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
  assert.equal(await redis.dbsize(), 1);
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
