import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
  NOTIFICATION_CREATED_CHANNEL,
  type NotificationCreatedEvent,
  type NotificationEventHandler,
  type NotificationEventPublisher
} from "./notification-events.js";
import type { Notification } from "@prisma/client";

export class RedisNotificationEvents implements NotificationEventPublisher {
  private readonly publisher = new Redis(env.REDIS_URL, { lazyConnect: true });
  private readonly subscriber = new Redis(env.REDIS_URL, { lazyConnect: true });
  private isStarted = false;

  constructor() {
    this.publisher.on("error", (error: Error) => logger.error("Notification Redis publisher error", { error }));
    this.subscriber.on("error", (error: Error) => logger.error("Notification Redis subscriber error", { error }));
  }

  async start(handler: NotificationEventHandler): Promise<void> {
    if (this.isStarted) {
      return;
    }

    await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
    await this.subscriber.subscribe(NOTIFICATION_CREATED_CHANNEL);

    this.subscriber.on("message", (channel, message) => {
      if (channel !== NOTIFICATION_CREATED_CHANNEL) {
        return;
      }

      void this.handleMessage(message, handler);
    });

    this.isStarted = true;
    logger.info("Notification Redis event bus started", { channel: NOTIFICATION_CREATED_CHANNEL });
  }

  async publishCreated(notification: Notification): Promise<void> {
    const event: NotificationCreatedEvent = {
      eventId: randomUUID(),
      notification,
      occurredAt: new Date().toISOString()
    };

    await this.publisher.publish(NOTIFICATION_CREATED_CHANNEL, JSON.stringify(event));
  }

  async stop(): Promise<void> {
    await Promise.allSettled([this.publisher.quit(), this.subscriber.quit()]);
    this.isStarted = false;
  }

  private async handleMessage(message: string, handler: NotificationEventHandler): Promise<void> {
    try {
      const event = JSON.parse(message) as NotificationCreatedEvent;
      await handler(event);
    } catch (error) {
      logger.error("Failed to handle notification event", { error });
    }
  }
}
