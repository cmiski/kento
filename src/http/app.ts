import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { env } from "../config/env.js";
import type { ConnectionRegistry } from "../realtime/connection-registry.js";
import { createAuthRouter } from "../auth/auth.routes.js";
import { requireAuth, type AuthenticatedRequest } from "../auth/http-auth.js";
import { createNotificationRouter } from "../notifications/notification.routes.js";
import type { NotificationService } from "../notifications/notification.service.js";
import { createPresenceRouter } from "../presence/presence.routes.js";
import type { PresenceService } from "../presence/presence.service.js";
import { createUserRateLimiter } from "./rate-limit.js";
import { errorHandler } from "./error-handler.js";
import { openApiDocument } from "./openapi.js";
import type Redis from "ioredis";
import { deliveryMetrics, type DeliveryMetrics } from "../observability/delivery-metrics.js";

export function createApp(
  connectionRegistry: ConnectionRegistry,
  notificationService: NotificationService,
  presenceService: PresenceService,
  rateLimitRedis: Redis,
  metrics: DeliveryMetrics = deliveryMetrics
): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "realtime-notification-hub"
    });
  });

  app.get("/openapi.json", (_req, res) => {
    res.status(200).json(openApiDocument);
  });

  app.get("/metrics", (_req, res) => {
    res.type("text/plain; version=0.0.4").send(metrics.render());
  });

  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use("/auth", createAuthRouter());
  const userRateLimiter = createUserRateLimiter(rateLimitRedis);
  app.use("/notifications", requireAuth, userRateLimiter, createNotificationRouter(notificationService));
  app.use("/presence", requireAuth, userRateLimiter, createPresenceRouter(presenceService));

  app.get("/connections/me", requireAuth, userRateLimiter, (req, res) => {
    const user = (req as AuthenticatedRequest).user;

    res.status(200).json(connectionRegistry.snapshotForUser(user.id));
  });

  app.use(errorHandler);

  return app;
}
