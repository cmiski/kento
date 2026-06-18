import Redis from "ioredis";
import { env } from "./env.js";
import { logger } from "./logger.js";

export function createRedisClient(name: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectionName: name
  });

  client.on("error", (error: Error) => logger.error("Redis client error", { name, error }));

  return client;
}
