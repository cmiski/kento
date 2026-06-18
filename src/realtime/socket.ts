import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

export async function createSocketServer(httpServer: HttpServer): Promise<Server> {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
      credentials: true
    },
    transports: ["websocket", "polling"]
  });

  const pubClient = new Redis(env.REDIS_URL, { lazyConnect: true });
  const subClient = pubClient.duplicate();

  pubClient.on("error", (error: Error) => logger.error("Redis pub client error", { error }));
  subClient.on("error", (error: Error) => logger.error("Redis sub client error", { error }));

  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));

  io.on("connection", (socket) => {
    logger.info("Socket connected", { socketId: socket.id });

    socket.emit("server:welcome", {
      socketId: socket.id,
      message: "Connected to realtime-notification-hub"
    });

    socket.on("ping:client", (payload, ack?: (response: { ok: boolean; receivedAt: string }) => void) => {
      logger.debug("Socket ping received", { socketId: socket.id, payload });
      ack?.({ ok: true, receivedAt: new Date().toISOString() });
    });

    socket.on("disconnect", (reason) => {
      logger.info("Socket disconnected", { socketId: socket.id, reason });
    });
  });

  return io;
}
