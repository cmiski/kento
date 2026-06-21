import type { NotificationChannel } from "@prisma/client";
import { logger } from "../config/logger.js";

type Outcome = "delivered" | "retrying" | "dead_letter" | "throttled";

const metricKey = (channel: NotificationChannel, outcome: Outcome): string => `${channel}:${outcome}`;

export class DeliveryMetrics {
  private readonly outcomes = new Map<string, number>();
  private processingSecondsCount = 0;
  private processingSecondsSum = 0;
  private queueDepth = 0;

  record(channel: NotificationChannel, outcome: Outcome, durationMs = 0): void {
    const key = metricKey(channel, outcome);
    this.outcomes.set(key, (this.outcomes.get(key) ?? 0) + 1);
    if (durationMs > 0) {
      this.processingSecondsCount += 1;
      this.processingSecondsSum += durationMs / 1000;
    }
    if (outcome === "dead_letter") {
      logger.error("Notification delivery moved to dead-letter queue", { channel });
    }
  }

  setQueueDepth(depth: number): void {
    this.queueDepth = depth;
  }

  render(): string {
    const lines = [
      "# HELP notification_delivery_outcomes_total Delivery outcomes by channel and result.",
      "# TYPE notification_delivery_outcomes_total counter"
    ];
    for (const [key, count] of [...this.outcomes.entries()].sort()) {
      const [channel, outcome] = key.split(":");
      lines.push(`notification_delivery_outcomes_total{channel="${channel}",outcome="${outcome}"} ${count}`);
    }
    lines.push(
      "# HELP notification_delivery_processing_seconds Time spent processing provider deliveries.",
      "# TYPE notification_delivery_processing_seconds summary",
      `notification_delivery_processing_seconds_count ${this.processingSecondsCount}`,
      `notification_delivery_processing_seconds_sum ${this.processingSecondsSum}`,
      "# HELP notification_delivery_queue_depth Jobs currently scheduled in Redis.",
      "# TYPE notification_delivery_queue_depth gauge",
      `notification_delivery_queue_depth ${this.queueDepth}`
    );
    return `${lines.join("\n")}\n`;
  }
}

export const deliveryMetrics = new DeliveryMetrics();
