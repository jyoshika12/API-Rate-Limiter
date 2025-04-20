const apiKeys = require("./apiKeys");

function apiKeyAuth(req, res, next) {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey || !apiKeys[apiKey]) {
    return res.status(401).json({ message: "Invalid or missing API key" });
  }

  // Attach user info to request for rate limiting
  req.apiKey = apiKey;
  req.user = apiKeys[apiKey];
  next();
}

module.exports = apiKeyAuth;
