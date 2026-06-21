import type { Notification } from "@prisma/client";
import type { Server } from "socket.io";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import type { NotificationCreatedEvent } from "../notifications/notification-events.js";
import type { NotificationService } from "../notifications/notification.service.js";

type NotificationSocketAck = {
  ok: boolean;
};

export class NotificationDelivery {
  constructor(
    private readonly io: Server,
    private readonly notificationService: NotificationService
  ) {}

  async deliverCreated(event: NotificationCreatedEvent): Promise<void> {
    const acknowledged = await this.attempt(event.notification, event.eventId, event.occurredAt);
    if (acknowledged) {
      await this.notificationService.markDelivered(event.notification.id, event.notification.recipientId);
    }
  }

  async deliverPendingForUser(userId: string): Promise<void> {
    const batchSize = 50;
    let cursor: string | undefined;

    do {
      const pending = await this.notificationService.listPendingForRecipient(userId, batchSize, cursor);

      for (const notification of pending) {
        const acknowledged = await this.attempt(notification, `pending:${notification.id}`, new Date().toISOString());
        if (acknowledged) {
          await this.notificationService.markDelivered(notification.id, notification.recipientId);
        }
      }

      cursor = pending.length === batchSize ? pending.at(-1)?.id : undefined;
    } while (cursor);
  }

  async attempt(notification: Notification, eventId: string, occurredAt: string): Promise<boolean> {
    const room = `user:${notification.recipientId}`;

    try {
      const responses = await this.io
        .to(room)
        .timeout(env.NOTIFICATION_DELIVERY_TIMEOUT_MS)
        .emitWithAck("notification:new", {
          eventId,
          occurredAt,
          notification
        });

      const acknowledged = responses.some((response: NotificationSocketAck) => response.ok);

      if (!acknowledged) {
        logger.info("Notification delivery had no acknowledgements", {
          notificationId: notification.id,
          recipientId: notification.recipientId
        });
        return false;
      }

      logger.info("Notification delivery acknowledged", {
        eventId,
        notificationId: notification.id,
        recipientId: notification.recipientId,
        acknowledgements: responses.length
      });
      return true;
    } catch (error) {
      logger.info("Notification delivery timed out or failed", {
        error,
        eventId,
        notificationId: notification.id,
        recipientId: notification.recipientId
      });
      return false;
    }
  }
}
