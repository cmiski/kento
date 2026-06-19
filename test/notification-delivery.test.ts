import { describe, expect, it, vi } from "vitest";
import { NotificationDelivery } from "../src/realtime/notification-delivery.js";

const notification = {
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

function createDelivery(ackResponses: Array<{ ok: boolean }> | Error) {
  const emitWithAck = vi.fn(async () => {
    if (ackResponses instanceof Error) {
      throw ackResponses;
    }

    return ackResponses;
  });
  const timeout = vi.fn(() => ({ emitWithAck }));
  const to = vi.fn(() => ({ timeout }));
  const io = { local: { to } };
  const notificationService = {
    listPendingForRecipient: vi.fn(async () => [notification]),
    markDelivered: vi.fn(async () => ({ ...notification, status: "DELIVERED" }))
  };

  return {
    io,
    notificationService,
    emitWithAck,
    delivery: new NotificationDelivery(io as never, notificationService as never)
  };
}

describe("NotificationDelivery", () => {
  it("marks a notification delivered when any socket acknowledges", async () => {
    const { delivery, io, notificationService } = createDelivery([{ ok: false }, { ok: true }]);

    await delivery.deliverCreated({
      eventId: "evt_1",
      occurredAt: "2026-01-01T00:00:00.000Z",
      notification: notification as never
    });

    expect(io.local.to).toHaveBeenCalledWith("user:user_1");
    expect(notificationService.markDelivered).toHaveBeenCalledWith(notification.id, "user_1");
  });

  it("keeps notifications pending when socket ack delivery times out", async () => {
    const { delivery, notificationService } = createDelivery(new Error("timeout"));

    await delivery.deliverCreated({
      eventId: "evt_1",
      occurredAt: "2026-01-01T00:00:00.000Z",
      notification: notification as never
    });

    expect(notificationService.markDelivered).not.toHaveBeenCalled();
  });

  it("replays pending notifications for a reconnecting user", async () => {
    const { delivery, notificationService, emitWithAck } = createDelivery([{ ok: true }]);

    await delivery.deliverPendingForUser("user_1");

    expect(notificationService.listPendingForRecipient).toHaveBeenCalledWith("user_1", 50);
    expect(emitWithAck).toHaveBeenCalledWith(
      "notification:new",
      expect.objectContaining({
        eventId: `pending:${notification.id}`,
        notification
      })
    );
  });
});
