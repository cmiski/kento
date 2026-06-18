import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";
import { logger } from "./logger.js";

export const prisma = new PrismaClient({
  log:
    env.NODE_ENV === "development"
      ? [
          { emit: "event", level: "query" },
          { emit: "event", level: "warn" },
          { emit: "event", level: "error" }
        ]
      : [
          { emit: "event", level: "warn" },
          { emit: "event", level: "error" }
        ]
});

prisma.$on("query", (event) => {
  logger.debug("Prisma query", {
    durationMs: event.duration,
    query: event.query
  });
});

prisma.$on("warn", (event) => {
  logger.warn("Prisma warning", { message: event.message });
});

prisma.$on("error", (event) => {
  logger.error("Prisma error", { message: event.message });
});
