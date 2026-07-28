import type { NextFunction, Request, Response } from "express";

import apiKeys from "./apiKeys.js";

interface ApiKeyUser {
  name: string;
  limit: number;
}

interface ApiKeyAuthenticatedRequest extends Request {
  apiKey?: string;
  user?: ApiKeyUser;
}

function apiKeyAuth(
  req: ApiKeyAuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Response | void {
  const apiKey = req.headers["x-api-key"];

  if (typeof apiKey !== "string" || !apiKeys[apiKey]) {
    return res.status(401).json({ message: "Invalid or missing API key" });
  }

  req.apiKey = apiKey;
  req.user = apiKeys[apiKey];
  next();
}

export = apiKeyAuth;
