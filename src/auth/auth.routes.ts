import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "./http-auth.js";
import { signAccessToken } from "./jwt.js";

const issueTokenSchema = z.object({
  userId: z.string().min(1).optional(),
  email: z.string().email(),
  roles: z.array(z.string().min(1)).default(["user"])
});

export function createAuthRouter(): Router {
  const router = Router();

  router.post("/token", (req, res) => {
    const result = issueTokenSchema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        error: "Invalid auth payload",
        details: result.error.flatten()
      });
      return;
    }

    const user = {
      id: result.data.userId ?? randomUUID(),
      email: result.data.email,
      roles: result.data.roles
    };

    res.status(201).json({
      accessToken: signAccessToken(user),
      tokenType: "Bearer",
      expiresInSeconds: 900,
      user
    });
  });

  router.get("/me", requireAuth, (req, res) => {
    res.status(200).json({
      user: (req as AuthenticatedRequest).user
    });
  });

  return router;
}
