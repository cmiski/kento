import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotificationService } from "../src/notifications/notification.service.js";
import { DeliveryDispatcher } from "../src/queue/delivery-dispatcher.js";
import { DeliveryQueuePublisher } from "../src/queue/delivery-queue-publisher.js";
import { DeliveryWorker } from "../src/queue/delivery-worker.js";
import { RedisDeliveryQueue } from "../src/queue/redis-delivery-queue.js";
import type { NotificationDelivery } from "../src/realtime/notification-delivery.js";

const runIntegration = process.env.RUN_DELIVERY_INTEGRATION === "1";
const integration = runIntegration ? describe : describe.skip;

integration("delivery pipeline integration", () => {
  const prisma = new PrismaClient();
  const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true });
  const queue = new RedisDeliveryQueue(redis);
  const realtime = { attempt: async () => true } as unknown as NotificationDelivery;
  const dispatcher = new DeliveryDispatcher(realtime);
  const worker = new DeliveryWorker(prisma, queue, dispatcher, redis);
  const service = new NotificationService(prisma, new DeliveryQueuePublisher(prisma, queue));
  const createdIds: string[] = [];

  beforeAll(async () => {
    await redis.connect();
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await prisma.notification.deleteMany({ where: { id: { in: createdIds } } });
    }
    await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
  });

  it("persists, queues, delivers, and audits an idempotent notification", async () => {
    const idempotencyKey = `integration:${randomUUID()}`;
    const notification = await service.create({
      recipientId: `integration-user:${randomUUID()}`,
      type: "SYSTEM",
      title: "Pipeline test",
      body: "End-to-end delivery",
      channels: ["EMAIL"],
      idempotencyKey
    });
    createdIds.push(notification.id);

    const duplicate = await service.create({
      recipientId: notification.recipientId,
      type: "SYSTEM",
      title: "Ignored duplicate",
      body: "Ignored duplicate",
      channels: ["EMAIL"],
      idempotencyKey
    });
    expect(duplicate.id).toBe(notification.id);
    expect(await worker.processNext(new Date(Date.now() + 100))).toBe(true);

    const history = await service.getDeliveryHistory(notification.id);
    expect(history?.deliveries).toHaveLength(1);
    expect(history?.deliveries[0]).toMatchObject({ channel: "EMAIL", status: "DELIVERED", attemptCount: 1 });
    expect(history?.deliveries[0]?.attempts).toHaveLength(1);
    expect(history?.deliveries[0]?.attempts[0]?.status).toBe("DELIVERED");
  });
});
