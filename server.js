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
  const currentTimestamp = Date.now();

  try {
    
    await redis.lpush(key, currentTimestamp);
    await redis.expire(key, 60); 

    
    const timestamps = await redis.lrange(key, 0, -1);

    
    const requestsWithinLastMinute = timestamps.filter(ts => {
      return currentTimestamp - parseInt(ts) < 60000;
    });
    const remainingRequests = userLimit - requestsWithinLastMinute.length;
    const resetInSeconds = 60 - Math.floor((currentTimestamp - parseInt(timestamps[0])) / 1000);

    if (requestsWithinLastMinute.length > userLimit) {
      return res.status(429).json({
        message: "Too many requests. Please wait.",
        remainingRequests,
        resetInSeconds:60,
      });
    }




    await redis.ltrim(key, 0, userLimit - 1);
    res.locals.remainingRequests = remainingRequests;
    res.locals.resetInSeconds = resetInSeconds;

    next();
  } catch (error) {
    console.error("Error with Redis:", error);
    return res.status(500).json({ message: "Internal Server Error. Please try again later." });
  }
});



app.get("/", (req, res) => {
  const remainingRequests = res.locals.remainingRequests;
  const resetInSeconds = res.locals.resetInSeconds;

  
  res.json({
    message: `Welcome! Your API key lets you make up to ${req.user.limit} requests per minute.`,
    remainingRequests,
    resetInSeconds,
  });
});


app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
