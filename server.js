const cors = require("cors");
const express = require("express");
const Redis = require("ioredis");
const apiKeyAuth = require("./apiKeyAuth");

const app = express();
const redis = new Redis(); // defaults to localhost:6379
const PORT = 5000;


// Apply API key auth middleware first
app.use(cors());
app.use(express.json());
app.use(apiKeyAuth);

// Redis-based rate limiting middleware
app.use(async (req, res, next) => {
  const ip = req.ip;
  const apiKey = req.apiKey;
  const userLimit = req.user.limit;

  const key = `rate-limit:${apiKey}:${ip}`;
  const currentTimestamp = Date.now();

  try {
    // Add current timestamp to Redis list
    await redis.lpush(key, currentTimestamp);
    await redis.expire(key, 60); // Always set expiry to clean up old keys

    // Get all recent timestamps from Redis
    const timestamps = await redis.lrange(key, 0, -1);

    // Filter timestamps that are within the last 60 seconds
    const requestsWithinLastMinute = timestamps.filter(ts => {
      return currentTimestamp - parseInt(ts) < 60000;
    });
    const remainingRequests = userLimit - requestsWithinLastMinute.length;
    const resetInSeconds = 60 - Math.floor((currentTimestamp - parseInt(timestamps[0])) / 1000);

    // Check if the count exceeds the allowed limit
    if (requestsWithinLastMinute.length > userLimit) {
      return res.status(429).json({
        message: "Too many requests. Please wait.",
        remainingRequests,
        resetInSeconds:60,
      });
    }




    // Trim to keep only the recent ones (optional cleanup)
    await redis.ltrim(key, 0, userLimit - 1);
    res.locals.remainingRequests = remainingRequests;
    res.locals.resetInSeconds = resetInSeconds;

    next();
  } catch (error) {
    console.error("Error with Redis:", error);
    return res.status(500).json({ message: "Internal Server Error. Please try again later." });
  }
});


// Sample route
app.get("/", (req, res) => {
  const remainingRequests = res.locals.remainingRequests;
  const resetInSeconds = res.locals.resetInSeconds;

  // Response shows how many requests the user is allowed based on their API key
  res.json({
    message: `Welcome! Your API key lets you make up to ${req.user.limit} requests per minute.`,
    remainingRequests,
    resetInSeconds,
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
