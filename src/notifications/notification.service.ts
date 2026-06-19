import { Prisma, type Notification, type PrismaClient } from "@prisma/client";
import type {
  AdminListNotificationsQuery,
  CreateNotificationInput,
  CreateTemplateNotificationInput,
  ListNotificationsQuery,
  SimulatePushInput
} from "./notification.schemas.js";
import type { NotificationEventPublisher } from "./notification-events.js";

const notificationTemplates = {
  welcome: {
    title: "Welcome, {{name}}",
    body: "Your realtime notification account is ready."
  },
  delivery_status: {
    title: "Delivery update for {{orderId}}",
    body: "Your delivery is now {{status}}."
  },
  security_alert: {
    title: "Security alert",
    body: "A security event was detected for {{email}}."
  },
  system_maintenance: {
    title: "Scheduled maintenance",
    body: "{{service}} maintenance starts at {{startsAt}}."
  }
} as const;

export class NotificationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: NotificationEventPublisher
  ) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    const notification = await this.prisma.notification.create({
      data: {
        recipientId: input.recipientId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data === undefined ? Prisma.JsonNull : (input.data as Prisma.InputJsonObject),
        templateKey: input.templateKey
      }
    });

    await this.events.publishCreated(notification);

    return notification;
  }

  async createFromTemplate(input: CreateTemplateNotificationInput): Promise<Notification> {
    const template = notificationTemplates[input.templateKey];
    const rendered = {
      title: this.renderTemplate(template.title, input.variables),
      body: this.renderTemplate(template.body, input.variables)
    };

    return this.create({
      recipientId: input.recipientId,
      type: input.type,
      title: rendered.title,
      body: rendered.body,
      data: input.data,
      templateKey: input.templateKey
    });
  }

  async list(query: AdminListNotificationsQuery): Promise<{
    items: Notification[];
    nextCursor: string | null;
  }> {
    return this.findPage({
      where: {
        recipientId: query.recipientId,
        status: query.status,
        type: query.type
      },
      limit: query.limit,
      cursor: query.cursor,
      orderBy: { createdAt: "desc" }
    });
  }

  async listForRecipient(recipientId: string, query: ListNotificationsQuery): Promise<{
    items: Notification[];
    nextCursor: string | null;
  }> {
    return this.findPage({
      where: {
        recipientId,
        status: query.status,
        type: query.type
      },
      limit: query.limit,
      cursor: query.cursor,
      orderBy: { createdAt: "desc" }
    });
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

  async updateStatus(notificationId: string, status: Notification["status"]): Promise<Notification | null> {
    const notification = await this.prisma.notification.findUnique({
      where: {
        id: notificationId
      }
    });

    if (!notification) {
      return null;
    }

    return this.prisma.notification.update({
      where: {
        id: notification.id
      },
      data: this.statusData(status)
    });
  }

  async listPendingForRecipient(recipientId: string, limit: number): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: {
        recipientId,
        status: "PENDING"
      },
      orderBy: {
        createdAt: "asc"
      },
      take: limit
    });
  }

  async simulatePush(notificationId: string, input: SimulatePushInput): Promise<Notification | null> {
    const notification = await this.prisma.notification.findUnique({
      where: {
        id: notificationId
      }
    });

    if (!notification) {
      return null;
    }

    const existingData =
      notification.data && typeof notification.data === "object" && !Array.isArray(notification.data)
        ? (notification.data as Prisma.JsonObject)
        : {};

    return this.prisma.notification.update({
      where: {
        id: notification.id
      },
      data: {
        ...this.statusData(input.status),
        data: {
          ...existingData,
          pushSimulation: {
            attemptedAt: new Date().toISOString(),
            status: input.status,
            providerMessageId: input.providerMessageId,
            error: input.error
          }
        }
      }
    });
  }

  async markDelivered(notificationId: string, recipientId: string): Promise<Notification | null> {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        recipientId,
        status: "PENDING"
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
        status: "DELIVERED",
        deliveredAt: new Date()
      }
    });
  }

  private async findPage(args: {
    where: Prisma.NotificationWhereInput;
    limit: number;
    cursor?: string;
    orderBy: Prisma.NotificationOrderByWithRelationInput;
  }): Promise<{
    items: Notification[];
    nextCursor: string | null;
  }> {
    const items = await this.prisma.notification.findMany({
      where: args.where,
      orderBy: args.orderBy,
      take: args.limit + 1,
      cursor: args.cursor ? { id: args.cursor } : undefined
    });

    const hasNextPage = items.length > args.limit;
    const pageItems = hasNextPage ? items.slice(0, args.limit) : items;
    const nextCursor = hasNextPage ? pageItems.at(-1)?.id ?? null : null;

    return {
      items: pageItems,
      nextCursor
    };
  }

  private renderTemplate(template: string, variables: Record<string, string>): string {
    return template.replaceAll(/\{\{(\w+)\}\}/g, (_match, key: string) => variables[key] ?? "");
  }

  private statusData(status: Notification["status"]): Prisma.NotificationUpdateInput {
    return {
      status,
      deliveredAt: status === "DELIVERED" ? new Date() : undefined,
      readAt: status === "READ" ? new Date() : undefined
    };
  }
}
