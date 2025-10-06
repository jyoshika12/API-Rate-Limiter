const cors = require("cors");
const express = require("express");
const Redis = require("ioredis");
const apiKeyAuth = require("./apiKeyAuth");

const app = express();
const redis = new Redis();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use(apiKeyAuth);

app.use(async (req, res, next) => {
    const ip = req.ip;
    const apiKey = req.apiKey;
    const userLimit = req.user.limit;

    const key = `rate-limit:${apiKey}:${ip}`;
    const currentTimestampMs = Date.now();
    const windowDurationMs = 60000; 
    const cutoffTimestampMs = currentTimestampMs - windowDurationMs;

    try {
    
        await redis.zremrangebyscore(key, 0, cutoffTimestampMs);

        await redis.zadd(key, currentTimestampMs, currentTimestampMs);

        const requestsWithinLastMinute = await redis.zcard(key);
        const remainingRequests = Math.max(0, userLimit - requestsWithinLastMinute);

        const oldestWithScores = await redis.zrange(key, 0, 0, "WITHSCORES");
        let oldestTimestamp = currentTimestampMs;

        if (oldestWithScores.length >= 2) {
            oldestTimestamp = parseInt(oldestWithScores[1]);
        }
        const timeToReset = 60 - Math.floor((currentTimestampMs - oldestTimestamp) / 1000);
        const resetInSeconds = Math.max(1, timeToReset);

        if (requestsWithinLastMinute > userLimit) {
            return res.status(429).json({
                message: "Too many requests. Please wait before sending another request.",
                remainingRequests: 0,
                resetInSeconds: resetInSeconds,
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

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
