import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default("*"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "verbose", "debug", "silly"]).default("info"),
  NOTIFICATION_DELIVERY_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  USER_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  USER_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  PRESENCE_TTL_SECONDS: z.coerce.number().int().positive().default(120)
});

export const env = envSchema.parse(process.env);
