import { describe, expect, it } from "vitest";
import { DeliveryMetrics } from "../src/observability/delivery-metrics.js";

describe("DeliveryMetrics", () => {
  it("exports Prometheus counters, latency, and queue depth", () => {
    const metrics = new DeliveryMetrics();
    metrics.record("EMAIL", "delivered", 250);
    metrics.record("SMS", "retrying", 100);
    metrics.setQueueDepth(3);

    const output = metrics.render();
    expect(output).toContain('notification_delivery_outcomes_total{channel="EMAIL",outcome="delivered"} 1');
    expect(output).toContain("notification_delivery_processing_seconds_count 2");
    expect(output).toContain("notification_delivery_processing_seconds_sum 0.35");
    expect(output).toContain("notification_delivery_queue_depth 3");
  });
});
