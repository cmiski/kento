import { describe, expect, it, vi } from "vitest";
import { NotificationService } from "../src/notifications/notification.service.js";

const baseNotification = {
  id: "1f7639b3-55b4-42c0-9944-3b8b4067c101",
  recipientId: "user_1",
  type: "USER",
  status: "PENDING",
  title: "Hello",
  body: "Body",
  data: null,
  templateKey: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  deliveredAt: null,
  readAt: null
} as const;

function createService() {
  const prisma = {
    notification: {
      create: vi.fn(async ({ data }) => ({ ...baseNotification, ...data })),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn()
    },
    channelPreference: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn()
    },
    notificationTemplate: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn()
    },
    $transaction: vi.fn(async (operations) =>
      typeof operations === "function" ? operations(prisma) : Promise.all(operations)
    )
  };
  const events = {
    publishCreated: vi.fn(async () => undefined)
  };

  return {
    prisma,
    events,
    service: new NotificationService(prisma as never, events)
  };
}

describe("NotificationService", () => {
  it("persists notifications and publishes creation events", async () => {
    const { service, prisma, events } = createService();

    const notification = await service.create({
      recipientId: "user_1",
      type: "USER",
      title: "Hello",
      body: "Body",
      data: { source: "test" }
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipientId: "user_1",
        title: "Hello",
        data: { source: "test" },
        channels: ["IN_APP"],
        deliveries: {
          create: [expect.objectContaining({ channel: "IN_APP", status: "QUEUED" })]
        }
      })
    });
    expect(events.publishCreated).toHaveBeenCalledWith(notification);
  });

  it("returns an existing notification for a repeated idempotency key", async () => {
    const { service, prisma, events } = createService();
    prisma.notification.findUnique.mockResolvedValue(baseNotification);

    const result = await service.create({
      recipientId: "user_1",
      type: "USER",
      title: "Duplicate",
      body: "Body",
      channels: ["EMAIL"],
      idempotencyKey: "request_123"
    });

    expect(result).toBe(baseNotification);
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(events.publishCreated).not.toHaveBeenCalled();
  });

  it("records disabled channel preferences as skipped without queue jobs", async () => {
    const { service, prisma } = createService();
    prisma.channelPreference.findMany.mockResolvedValue([{ channel: "SMS", enabled: false }]);

    await service.create({
      recipientId: "user_1",
      type: "USER",
      title: "Hello",
      body: "Body",
      channels: ["IN_APP", "SMS"]
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deliveries: {
          create: expect.arrayContaining([
            expect.objectContaining({ channel: "IN_APP", status: "QUEUED" }),
            expect.objectContaining({ channel: "SMS", status: "SKIPPED", job: undefined })
          ])
        }
      })
    });
  });

  it("renders reusable template notifications before persistence", async () => {
    const { service, prisma } = createService();

    await service.createFromTemplate({
      recipientId: "user_1",
      type: "SYSTEM",
      templateKey: "delivery_status",
      variables: { orderId: "ord_123", status: "out for delivery" }
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipientId: "user_1",
        title: "Delivery update for ord_123",
        body: "Your delivery is now out for delivery.",
        templateKey: "delivery_status"
      })
    });
  });

  it("only marks pending recipient notifications as delivered", async () => {
    const { service, prisma } = createService();
    prisma.notification.findFirst.mockResolvedValue(baseNotification);
    prisma.notification.update.mockResolvedValue({ ...baseNotification, status: "DELIVERED" });

    await service.markDelivered(baseNotification.id, "user_1");

    expect(prisma.notification.findFirst).toHaveBeenCalledWith({
      where: {
        id: baseNotification.id,
        recipientId: "user_1",
        status: "PENDING"
      }
    });
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: baseNotification.id },
      data: expect.objectContaining({ status: "DELIVERED", deliveredAt: expect.any(Date) })
    });
  });

  it("records simulated push delivery metadata and status", async () => {
    const { service, prisma } = createService();
    prisma.notification.findUnique.mockResolvedValue({ ...baseNotification, data: { channel: "socket" } });
    prisma.notification.update.mockResolvedValue({ ...baseNotification, status: "FAILED" });

    await service.simulatePush(baseNotification.id, {
      status: "FAILED",
      error: "provider unavailable"
    });

    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: baseNotification.id },
      data: expect.objectContaining({
        status: "FAILED",
        data: expect.objectContaining({
          channel: "socket",
          pushSimulation: expect.objectContaining({
            status: "FAILED",
            error: "provider unavailable"
          })
        })
      })
    });
  });

  it("skips the cursor notification when listing the next page", async () => {
    const { service, prisma } = createService();
    prisma.notification.findMany.mockResolvedValue([baseNotification]);

    await service.listForRecipient("user_1", {
      limit: 25,
      cursor: baseNotification.id
    });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: baseNotification.id },
        skip: 1
      })
    );
  });
});
