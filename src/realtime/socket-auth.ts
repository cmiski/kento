import type { ExtendedError, Socket } from "socket.io";
import { verifyAccessToken } from "../auth/jwt.js";

export function authenticateSocket(socket: Socket, next: (err?: ExtendedError) => void): void {
  const token = resolveSocketToken(socket);

  if (!token) {
    next(new Error("Missing authentication token"));
    return;
  }

  try {
    socket.data.user = verifyAccessToken(token);
    next();
  } catch {
    next(new Error("Invalid or expired authentication token"));
  }
}

function resolveSocketToken(socket: Socket): string | null {
  const authToken = socket.handshake.auth.token;
  if (typeof authToken === "string" && authToken.length > 0) {
    return authToken;
  }

  const authorization = socket.handshake.headers.authorization;
  if (typeof authorization !== "string") {
    return null;
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}
