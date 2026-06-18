import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";
import type { AuthTokenPayload, AuthUser } from "./auth.types.js";

const tokenPayloadSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  roles: z.array(z.string().min(1)),
  type: z.literal("access")
});

export function signAccessToken(user: AuthUser): string {
  const payload: AuthTokenPayload = {
    ...user,
    type: "access"
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "15m",
    subject: user.id,
    audience: "realtime-notification-hub",
    issuer: "realtime-notification-hub"
  });
}

export function verifyAccessToken(token: string): AuthUser {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ["HS256"],
    audience: "realtime-notification-hub",
    issuer: "realtime-notification-hub"
  });

  const payload = tokenPayloadSchema.parse(decoded);

  return {
    id: payload.id,
    email: payload.email,
    roles: payload.roles
  };
}
