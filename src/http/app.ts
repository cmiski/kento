import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { env } from "../config/env.js";
import type { ConnectionRegistry } from "../realtime/connection-registry.js";
import { createAuthRouter } from "../auth/auth.routes.js";
import { requireAuth, type AuthenticatedRequest } from "../auth/http-auth.js";
import { createNotificationRouter } from "../notifications/notification.routes.js";
import type { NotificationService } from "../notifications/notification.service.js";
import { errorHandler } from "./error-handler.js";

export function createApp(
  connectionRegistry: ConnectionRegistry,
  notificationService: NotificationService
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

  app.use("/auth", createAuthRouter());
  app.use("/notifications", createNotificationRouter(notificationService));

  app.get("/connections/me", requireAuth, (req, res) => {
    const user = (req as AuthenticatedRequest).user;

    res.status(200).json(connectionRegistry.snapshotForUser(user.id));
  });

  app.use(errorHandler);

  return app;
}
