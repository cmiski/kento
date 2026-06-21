import type { Notification, PrismaClient } from "@prisma/client";
import type { NotificationEventPublisher } from "../notifications/notification-events.js";
import type { RedisDeliveryQueue } from "./redis-delivery-queue.js";

export class DeliveryQueuePublisher implements NotificationEventPublisher {
  constructor(private readonly prisma: PrismaClient, private readonly queue: RedisDeliveryQueue) {}

  async publishCreated(notification: Notification): Promise<void> {
    const jobs = await this.prisma.deliveryJob.findMany({
      where: { delivery: { notificationId: notification.id }, status: "AVAILABLE" }
    });
    await Promise.all(jobs.map((job) => this.queue.enqueue(job.id, job.runAt)));
  }
}
