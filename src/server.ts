import { createServer } from "node:http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { createApp } from "./http/app.js";
import { NotificationService } from "./notifications/notification.service.js";
import { prisma } from "./config/prisma.js";
import { ConnectionRegistry } from "./realtime/connection-registry.js";
import { NotificationDispatcher } from "./realtime/notification-dispatcher.js";
import { createSocketServer } from "./realtime/socket.js";
import { RedisNotificationEvents } from "./notifications/redis-notification-events.js";

async function bootstrap(): Promise<void> {
  const connectionRegistry = new ConnectionRegistry();
  const notificationEvents = new RedisNotificationEvents();
  const notificationService = new NotificationService(prisma, notificationEvents);
  const app = createApp(connectionRegistry, notificationService);
  const httpServer = createServer(app);
  const io = await createSocketServer(httpServer, connectionRegistry);
  const notificationDispatcher = new NotificationDispatcher(io);

  await notificationEvents.start((event) => notificationDispatcher.dispatchCreated(event));

  httpServer.listen(env.PORT, () => {
    logger.info("HTTP and Socket.io server listening", { port: env.PORT });
  });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info("Shutdown requested", { signal });
    io.close();
    await notificationEvents.stop();
    await prisma.$disconnect();
    httpServer.close((error?: Error) => {
      if (error) {
        logger.error("HTTP server closed with error", { error });
        process.exit(1);
      }

      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

bootstrap().catch((error: unknown) => {
  logger.error("Failed to start server", { error });
  process.exit(1);
});
