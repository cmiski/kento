import type { Notification, NotificationChannel } from "@prisma/client";
import type { NotificationDelivery } from "../realtime/notification-delivery.js";

export type DispatchResult = {
  delivered: boolean;
  retryable: boolean;
  providerMessageId?: string;
  error?: string;
  metadata?: Record<string, string>;
};

export class DeliveryDispatcher {
  constructor(private readonly realtimeDelivery: NotificationDelivery) {}

  async dispatch(channel: NotificationChannel, notification: Notification, deliveryId: string): Promise<DispatchResult> {
    if (channel === "IN_APP") {
      const delivered = await this.realtimeDelivery.attempt(
        notification,
        `delivery:${deliveryId}`,
        new Date().toISOString()
      );
      return delivered
        ? { delivered: true, retryable: false, providerMessageId: `socket:${deliveryId}` }
        : { delivered: false, retryable: true, error: "No recipient socket acknowledged delivery" };
    }

    const data = notification.data && typeof notification.data === "object" && !Array.isArray(notification.data)
      ? notification.data as Record<string, unknown>
      : {};
    const failedChannels = Array.isArray(data.simulateFailureChannels) ? data.simulateFailureChannels : [];
    const permanentChannels = Array.isArray(data.simulatePermanentFailureChannels)
      ? data.simulatePermanentFailureChannels
      : [];

    if (failedChannels.includes(channel) || permanentChannels.includes(channel)) {
      return {
        delivered: false,
        retryable: !permanentChannels.includes(channel),
        error: `Simulated ${channel} provider failure`
      };
    }

    return {
      delivered: true,
      retryable: false,
      providerMessageId: `${channel.toLowerCase()}:${deliveryId}`,
      metadata: { provider: "simulation", idempotencyKey: deliveryId }
    };
  }
}
