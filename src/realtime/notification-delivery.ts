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
    await this.deliverNotification(event.notification, event.eventId, event.occurredAt);
  }

  async deliverPendingForUser(userId: string): Promise<void> {
    const pending = await this.notificationService.listPendingForRecipient(userId, 50);

    for (const notification of pending) {
      await this.deliverNotification(notification, `pending:${notification.id}`, new Date().toISOString());
    }
  }

  private async deliverNotification(notification: Notification, eventId: string, occurredAt: string): Promise<void> {
    const room = `user:${notification.recipientId}`;

    try {
      const responses = await this.io.local
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
        return;
      }

      await this.notificationService.markDelivered(notification.id, notification.recipientId);
      logger.info("Notification delivery acknowledged", {
        eventId,
        notificationId: notification.id,
        recipientId: notification.recipientId,
        acknowledgements: responses.length
      });
    } catch (error) {
      logger.info("Notification delivery timed out or failed", {
        error,
        eventId,
        notificationId: notification.id,
        recipientId: notification.recipientId
      });
    }
  }
}
