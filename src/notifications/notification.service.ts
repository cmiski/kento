import { Prisma, type Notification, type PrismaClient } from "@prisma/client";
import type { CreateNotificationInput, ListNotificationsQuery } from "./notification.schemas.js";

export class NotificationService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        recipientId: input.recipientId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data === undefined ? Prisma.JsonNull : (input.data as Prisma.InputJsonObject),
        templateKey: input.templateKey
      }
    });
  }

  async listForRecipient(recipientId: string, query: ListNotificationsQuery): Promise<{
    items: Notification[];
    nextCursor: string | null;
  }> {
    const items = await this.prisma.notification.findMany({
      where: {
        recipientId,
        status: query.status,
        type: query.type
      },
      orderBy: {
        createdAt: "desc"
      },
      take: query.limit + 1,
      cursor: query.cursor ? { id: query.cursor } : undefined
    });

    const hasNextPage = items.length > query.limit;
    const pageItems = hasNextPage ? items.slice(0, query.limit) : items;
    const nextCursor = hasNextPage ? pageItems.at(-1)?.id ?? null : null;

    return {
      items: pageItems,
      nextCursor
    };
  }

  async markRead(notificationId: string, recipientId: string): Promise<Notification | null> {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        recipientId
      }
    });

    if (!notification) {
      return null;
    }

    return this.prisma.notification.update({
      where: {
        id: notification.id
      },
      data: {
        status: "READ",
        readAt: new Date()
      }
    });
  }
}
