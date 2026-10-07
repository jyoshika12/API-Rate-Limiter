import path from "node:path";
import cors from "cors";
import express from "express";
import { redis } from "./redisClient.js";
import { keyAdmin } from "./keyAdmin.js";

import apiKeyAuth from "./apiKeyAuth.js";
import { checkLimit } from "./limiter.js";

interface ApiKeyUser {
  name: string;
  limit: number;
}

declare module "express-serve-static-core" {
  interface Request {
    apiKey: string;
    user: ApiKeyUser;
  }
}

const app = express();
export { redis };

app.use(cors());
app.use(express.json());
app.use("/demo", express.static(path.join(process.cwd(), "public")));
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/admin/keys", keyAdmin);
app.use(apiKeyAuth);

app.use(async (req, res, next) => {
  const ip = req.ip;
  const apiKey = req.apiKey;
  const userLimit = req.user.limit;

  const key = `${process.env.RATE_LIMIT_PREFIX ?? "rate-limit:"}${apiKey}:${ip}`;
  try {
    const {
      allowed,
      remaining: remainingRequests,
      resetInSeconds,
    } = await checkLimit(redis, key, userLimit);
    res.setHeader("X-RateLimit-Limit", userLimit);
    res.setHeader("X-RateLimit-Remaining", remainingRequests);
    if (!allowed) {
      res.setHeader("Retry-After", resetInSeconds);
      return res.status(429).json({
        message: "Too many requests. Please wait before sending another request.",
        remainingRequests: 0,
        resetInSeconds,
      });
    }
    res.locals.remainingRequests = remainingRequests;
    res.locals.resetInSeconds = resetInSeconds;

    next();
  } catch (error) {
    console.error("Redis Error:", error);
    return res.status(500).json({
      message: "Internal Server Error. Please try again later.",
    });
  }
});

app.get("/", (req, res) => {
  const remainingRequests = res.locals.remainingRequests;
  const resetInSeconds = res.locals.resetInSeconds;

  res.json({
    message: `Welcome! Your API key allows ${req.user.limit} requests per minute.`,
    remainingRequests,
    resetInSeconds,
  });
});

export default app;
