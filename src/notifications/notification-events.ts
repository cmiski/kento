import type { Notification } from "@prisma/client";

export const NOTIFICATION_CREATED_CHANNEL = "notifications.created";

export type NotificationCreatedEvent = {
  eventId: string;
  notification: Notification;
  occurredAt: string;
};

export type NotificationEventPublisher = {
  publishCreated(notification: Notification): Promise<void>;
};

export type NotificationEventHandler = (event: NotificationCreatedEvent) => void | Promise<void>;
