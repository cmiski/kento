import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verifyAccessToken } from "./jwt.js";
import type { AuthUser } from "./auth.types.js";

export type AuthenticatedRequest = Request & {
  user: AuthUser;
};

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const token = extractBearerToken(req.header("authorization"));

  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  try {
    (req as AuthenticatedRequest).user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
};
