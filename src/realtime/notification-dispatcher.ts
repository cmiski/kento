import type { Server } from "socket.io";
import { logger } from "../config/logger.js";
import type { NotificationCreatedEvent } from "../notifications/notification-events.js";

export class NotificationDispatcher {
  constructor(private readonly io: Server) {}

  async dispatchCreated(event: NotificationCreatedEvent): Promise<void> {
    const room = `user:${event.notification.recipientId}`;

    this.io.to(room).emit("notification:new", {
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      notification: event.notification
    });

    logger.info("Notification dispatched to realtime room", {
      eventId: event.eventId,
      notificationId: event.notification.id,
      recipientId: event.notification.recipientId,
      room
    });
  }
}
