import type { NextFunction, Request, RequestHandler, Response } from "express";
import type Redis from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import type { AuthenticatedRequest } from "../auth/http-auth.js";

export function createUserRateLimiter(redis: Redis): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Partial<AuthenticatedRequest>).user;

    if (!user) {
      next();
      return;
    }

    const key = `rate-limit:user:${user.id}`;

    try {
      const count = await redis.incr(key);

      if (count === 1) {
        await redis.expire(key, env.USER_RATE_LIMIT_WINDOW_SECONDS);
      }

      res.setHeader("X-RateLimit-Limit", env.USER_RATE_LIMIT_MAX_REQUESTS.toString());
      res.setHeader("X-RateLimit-Remaining", Math.max(env.USER_RATE_LIMIT_MAX_REQUESTS - count, 0).toString());

      if (count > env.USER_RATE_LIMIT_MAX_REQUESTS) {
        res.status(429).json({
          error: "Rate limit exceeded",
          retryAfterSeconds: await redis.ttl(key)
        });
        return;
      }

      next();
    } catch (error) {
      logger.error("Rate limiter failed open", { error, userId: user.id });
      next();
    }
  };
}
