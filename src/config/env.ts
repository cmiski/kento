import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default("*"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "verbose", "debug", "silly"]).default("info")
});

export const env = envSchema.parse(process.env);
