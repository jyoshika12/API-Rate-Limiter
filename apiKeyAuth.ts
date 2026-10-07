import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import apiKeys from "./apiKeys.js";
import { redis } from "./redisClient.js";

async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey !== "string" || !apiKey || apiKey.length > 256) {
    res.status(401).json({ message: "Invalid or missing API key" });
    return;
  }
  const demoEnabled =
    process.env.ENABLE_DEMO_KEYS === "true" ||
    (process.env.ENABLE_DEMO_KEYS !== "false" && process.env.NODE_ENV !== "production");
  if (demoEnabled && Object.hasOwn(apiKeys, apiKey)) {
    req.apiKey = apiKey;
    req.user = apiKeys[apiKey];
    next();
    return;
  }
  try {
    const hash = createHash("sha256").update(apiKey).digest("hex");
    const user = await redis.hgetall(
      (process.env.RATE_LIMIT_PREFIX ?? "rate-limit:") + "key:" + hash,
    );
    if (!user.name || !Number.isInteger(Number(user.limit)) || Number(user.limit) < 1) {
      res.status(401).json({ message: "Invalid or missing API key" });
      return;
    }
    req.apiKey = hash;
    req.user = { name: user.name, limit: Number(user.limit) };
    next();
  } catch {
    res.status(503).json({ message: "Authentication store unavailable" });
  }
}
export = apiKeyAuth;
