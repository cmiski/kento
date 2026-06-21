import { createServer } from "node:http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { createApp } from "./http/app.js";
import { NotificationService } from "./notifications/notification.service.js";
import { prisma } from "./config/prisma.js";
import { ConnectionRegistry } from "./realtime/connection-registry.js";
import { createSocketServer } from "./realtime/socket.js";
import { createRedisClient } from "./config/redis.js";
import { PresenceService } from "./presence/presence.service.js";
import { RedisDeliveryQueue } from "./queue/redis-delivery-queue.js";
import { DeliveryQueuePublisher } from "./queue/delivery-queue-publisher.js";
import { DeliveryDispatcher } from "./queue/delivery-dispatcher.js";
import { DeliveryWorker } from "./queue/delivery-worker.js";

async function bootstrap(): Promise<void> {
  const connectionRegistry = new ConnectionRegistry();
  const presenceRedis = createRedisClient("presence");
  const rateLimitRedis = createRedisClient("rate-limit");
  const deliveryRedis = createRedisClient("delivery-queue");
  await Promise.all([presenceRedis.connect(), rateLimitRedis.connect(), deliveryRedis.connect()]);

  const presenceService = new PresenceService(presenceRedis);
  const deliveryQueue = new RedisDeliveryQueue(deliveryRedis);
  const notificationEvents = new DeliveryQueuePublisher(prisma, deliveryQueue);
  const notificationService = new NotificationService(prisma, notificationEvents);
  const app = createApp(connectionRegistry, notificationService, presenceService, rateLimitRedis);
  const httpServer = createServer(app);
  const realtime = await createSocketServer(
    httpServer,
    connectionRegistry,
    notificationService,
    presenceService
  );

  const deliveryWorker = new DeliveryWorker(
    prisma,
    deliveryQueue,
    new DeliveryDispatcher(realtime.notificationDelivery),
    deliveryRedis
  );
  await deliveryWorker.start();

  httpServer.listen(env.PORT, () => {
    logger.info("HTTP and Socket.io server listening", { port: env.PORT });
  });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info("Shutdown requested", { signal });
    await deliveryWorker.stop();
    await realtime.close();
    await Promise.allSettled([presenceRedis.quit(), rateLimitRedis.quit(), deliveryRedis.quit()]);
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
