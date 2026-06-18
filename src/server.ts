import { createServer } from "node:http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { createApp } from "./http/app.js";
import { NotificationService } from "./notifications/notification.service.js";
import { prisma } from "./config/prisma.js";
import { ConnectionRegistry } from "./realtime/connection-registry.js";
import { createSocketServer } from "./realtime/socket.js";
import { RedisNotificationEvents } from "./notifications/redis-notification-events.js";
import { createRedisClient } from "./config/redis.js";
import { PresenceService } from "./presence/presence.service.js";

async function bootstrap(): Promise<void> {
  const connectionRegistry = new ConnectionRegistry();
  const presenceRedis = createRedisClient("presence");
  const rateLimitRedis = createRedisClient("rate-limit");
  await Promise.all([presenceRedis.connect(), rateLimitRedis.connect()]);

  const presenceService = new PresenceService(presenceRedis);
  const notificationEvents = new RedisNotificationEvents();
  const notificationService = new NotificationService(prisma, notificationEvents);
  const app = createApp(connectionRegistry, notificationService, presenceService, rateLimitRedis);
  const httpServer = createServer(app);
  const realtime = await createSocketServer(
    httpServer,
    connectionRegistry,
    notificationService,
    presenceService
  );

  await notificationEvents.start((event) => realtime.notificationDelivery.deliverCreated(event));

  httpServer.listen(env.PORT, () => {
    logger.info("HTTP and Socket.io server listening", { port: env.PORT });
  });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info("Shutdown requested", { signal });
    realtime.io.close();
    await notificationEvents.stop();
    await Promise.allSettled([presenceRedis.quit(), rateLimitRedis.quit()]);
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
