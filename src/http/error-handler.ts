import type { ErrorRequestHandler } from "express";
import { logger } from "../config/logger.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  logger.error("Unhandled HTTP error", { error });

  res.status(500).json({
    error: "Internal server error"
  });
};
