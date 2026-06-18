import type { AuthUser } from "../auth/auth.types.js";

declare module "socket.io" {
  interface SocketData {
    user: AuthUser;
  }
}
