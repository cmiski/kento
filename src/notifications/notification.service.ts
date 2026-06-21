import { Prisma, type Notification, type PrismaClient } from "@prisma/client";
import type {
  AdminListNotificationsQuery,
  CreateNotificationInput,
  CreateTemplateNotificationInput,
  ListNotificationsQuery,
  SimulatePushInput,
  UpdateChannelPreferencesInput,
  CreateTemplateDefinitionInput,
  ListTemplateDefinitionsQuery
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
    if (input.idempotencyKey) {
      const existing = await this.prisma.notification.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        return existing;
      }
    }

    const channels = [...new Set(input.channels ?? ["IN_APP"])] as CreateNotificationInput["channels"];
    const preferences = await this.prisma.channelPreference.findMany({
      where: { userId: input.recipientId, channel: { in: channels } }
    });
    const preferenceByChannel = new Map(preferences.map((preference) => [preference.channel, preference]));
    const runAt = input.scheduledAt ?? new Date();

    let notification: Notification;
    try {
      notification = await this.prisma.notification.create({
        data: {
          recipientId: input.recipientId,
          type: input.type,
          title: input.title,
          body: input.body,
          data: input.data === undefined ? Prisma.JsonNull : (input.data as Prisma.InputJsonObject),
          templateKey: input.templateKey,
          templateVersion: input.templateVersion,
          idempotencyKey: input.idempotencyKey,
          scheduledAt: input.scheduledAt,
          channels,
          deliveries: {
            create: channels.map((channel) => {
              const enabled = preferenceByChannel.get(channel)?.enabled !== false;
              return {
                channel,
                status: enabled ? "QUEUED" : "SKIPPED",
                nextAttemptAt: runAt,
                job: enabled ? { create: { runAt } } : undefined
              };
            })
          }
        }
      });
    } catch (error) {
      if (input.idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.prisma.notification.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (existing) {
          return existing;
        }
      }
      throw error;
    }

    await this.events.publishCreated(notification);

    return notification;
  }

  async createFromTemplate(input: CreateTemplateNotificationInput): Promise<Notification> {
    const persistedTemplate = await this.prisma.notificationTemplate.findFirst({
      where: {
        key: input.templateKey,
        version: input.templateVersion,
        channel: { in: input.channels ?? ["IN_APP"] },
        active: input.templateVersion ? undefined : true
      },
      orderBy: [{ version: "desc" }, { channel: "asc" }]
    });
    const fallback = notificationTemplates[input.templateKey as keyof typeof notificationTemplates];
    const template = persistedTemplate ?? fallback;
    if (!template) {
      throw new Error(`Notification template not found: ${input.templateKey}`);
    }
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
      templateKey: input.templateKey,
      templateVersion: persistedTemplate?.version ?? input.templateVersion ?? 1,
      channels: input.channels,
      idempotencyKey: input.idempotencyKey,
      scheduledAt: input.scheduledAt
    });
  }

  async getPreferences(userId: string) {
    return this.prisma.channelPreference.findMany({ where: { userId }, orderBy: { channel: "asc" } });
  }

  async updatePreferences(userId: string, input: UpdateChannelPreferencesInput) {
    return this.prisma.$transaction(
      input.preferences.map((preference) =>
        this.prisma.channelPreference.upsert({
          where: { userId_channel: { userId, channel: preference.channel } },
          create: {
            userId,
            channel: preference.channel,
            enabled: preference.enabled,
            destination: preference.destination,
            metadata: preference.metadata as Prisma.InputJsonObject | undefined
          },
          update: {
            enabled: preference.enabled,
            destination: preference.destination,
            metadata: preference.metadata as Prisma.InputJsonObject | undefined
          }
        })
      )
    );
  }

  async createTemplateDefinition(input: CreateTemplateDefinitionInput) {
    return this.prisma.$transaction(async (tx) => {
      if (input.active) {
        await tx.notificationTemplate.updateMany({
          where: { key: input.key, channel: input.channel, active: true },
          data: { active: false }
        });
      }
      return tx.notificationTemplate.create({ data: input });
    });
  }

  async listTemplateDefinitions(query: ListTemplateDefinitionsQuery) {
    return this.prisma.notificationTemplate.findMany({
      where: { key: query.key, channel: query.channel },
      orderBy: [{ key: "asc" }, { version: "desc" }, { channel: "asc" }]
    });
  }

  async getDeliveryHistory(notificationId: string) {
    return this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: {
        deliveries: {
          orderBy: { channel: "asc" },
          include: { attempts: { orderBy: { attemptNumber: "asc" } }, job: true }
        }
      }
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

  async listPendingForRecipient(recipientId: string, limit: number, cursor?: string): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: {
        recipientId,
        status: "PENDING"
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : undefined
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
      cursor: args.cursor ? { id: args.cursor } : undefined,
      skip: args.cursor ? 1 : undefined
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
