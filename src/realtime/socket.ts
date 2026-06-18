import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { authenticateSocket } from "./socket-auth.js";
import type { ConnectionRegistry } from "./connection-registry.js";
import { NotificationDelivery } from "./notification-delivery.js";
import type { PresenceService } from "../presence/presence.service.js";
import type { NotificationService } from "../notifications/notification.service.js";

export type RealtimeServer = {
  io: Server;
  notificationDelivery: NotificationDelivery;
};

export async function createSocketServer(
  httpServer: HttpServer,
  connectionRegistry: ConnectionRegistry,
  notificationService: NotificationService,
  presenceService: PresenceService
): Promise<RealtimeServer> {
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
  io.use(authenticateSocket);
  const notificationDelivery = new NotificationDelivery(io, notificationService);

  io.on("connection", async (socket) => {
    const connection = connectionRegistry.add(socket.id, socket.data.user);
    const userRoom = `user:${connection.user.id}`;
    socket.join(userRoom);
    const presence = await presenceService.markOnline(connection.user, socket.id);

    logger.info("Socket connected", {
      socketId: socket.id,
      userId: connection.user.id,
      socketsForUser: connectionRegistry.getUserSocketCount(connection.user.id),
      presence
    });

    socket.emit("server:welcome", {
      socketId: socket.id,
      userId: connection.user.id,
      message: "Connected to realtime-notification-hub"
    });

    socket.emit("presence:update", presence);
    await notificationDelivery.deliverPendingForUser(connection.user.id);

    socket.on("ping:client", (payload, ack?: (response: { ok: boolean; receivedAt: string }) => void) => {
      logger.debug("Socket ping received", { socketId: socket.id, payload });
      ack?.({ ok: true, receivedAt: new Date().toISOString() });
    });

    socket.on("disconnect", async (reason) => {
      const removedConnection = connectionRegistry.remove(socket.id);
      const presenceState = removedConnection
        ? await presenceService.markOffline(removedConnection.user.id, socket.id)
        : null;

      logger.info("Socket disconnected", {
        socketId: socket.id,
        userId: removedConnection?.user.id,
        reason,
        presence: presenceState,
        socketsForUser: removedConnection
          ? connectionRegistry.getUserSocketCount(removedConnection.user.id)
          : 0
      });
    });
  });

  return {
    io,
    notificationDelivery
  };
}
