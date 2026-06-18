import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { env } from "../config/env.js";

export function createApp(): Express {
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

  return app;
}
