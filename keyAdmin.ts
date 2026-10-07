import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { redis } from "./redisClient.js";

const limits: Record<string, number> = { free: 5, pro: 20, admin: 100 };
export const keyAdmin = Router();
keyAdmin.use((req, res, next) => {
  const configured = process.env.ADMIN_TOKEN;
  if (!configured) {
    res.status(503).json({ message: "Key management is disabled; configure ADMIN_TOKEN" });
    return;
  }
  const supplied = req.headers["x-admin-token"];
  if (
    typeof supplied !== "string" ||
    !timingSafeEqual(
      createHash("sha256").update(configured).digest(),
      createHash("sha256").update(supplied).digest(),
    )
  ) {
    res.status(401).json({ message: "Invalid admin token" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  next();
});
keyAdmin.post("/", async (req, res) => {
  const { name, tier } = req.body ?? {};
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 80 ||
    typeof tier !== "string" ||
    !Object.hasOwn(limits, tier)
  ) {
    res
      .status(400)
      .json({ message: "Provide a name (1–80 characters) and tier: free, pro or admin" });
    return;
  }
  const apiKey = "quota_" + randomBytes(32).toString("hex");
  const keyId = createHash("sha256").update(apiKey).digest("hex");
  try {
    await redis.hset((process.env.RATE_LIMIT_PREFIX ?? "rate-limit:") + "key:" + keyId, {
      name: name.trim(),
      tier,
      limit: limits[tier],
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({
      keyId,
      apiKey,
      tier,
      limit: limits[tier],
      message: "Save this key; it is shown only once.",
    });
  } catch {
    res.status(503).json({ message: "Key store unavailable" });
  }
});
keyAdmin.delete("/:keyId", async (req, res) => {
  const keyId = req.params.keyId;
  if (typeof keyId !== "string" || !/^[a-f0-9]{64}$/.test(keyId)) {
    res.status(400).json({ message: "Invalid key ID" });
    return;
  }
  try {
    const removed = await redis.del(
      (process.env.RATE_LIMIT_PREFIX ?? "rate-limit:") + "key:" + keyId,
    );
    res.status(removed ? 204 : 404).end();
  } catch {
    res.status(503).json({ message: "Key store unavailable" });
  }
});
