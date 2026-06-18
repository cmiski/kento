import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { env } from "../config/env.js";
import type { ConnectionRegistry } from "../realtime/connection-registry.js";
import { createAuthRouter } from "../auth/auth.routes.js";
import { requireAuth, type AuthenticatedRequest } from "../auth/http-auth.js";

export function createApp(connectionRegistry: ConnectionRegistry): Express {
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

  app.get("/connections/me", requireAuth, (req, res) => {
    const user = (req as AuthenticatedRequest).user;

    res.status(200).json(connectionRegistry.snapshotForUser(user.id));
  });

  return app;
}
