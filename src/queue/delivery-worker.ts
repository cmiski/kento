import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import type { DeliveryDispatcher, DispatchResult } from "./delivery-dispatcher.js";
import type { RedisDeliveryQueue } from "./redis-delivery-queue.js";
import { deliveryMetrics, type DeliveryMetrics } from "../observability/delivery-metrics.js";

export class DeliveryWorker {
  private readonly workerId = randomUUID();
  private pollTimer?: NodeJS.Timeout;
  private recoveryTimer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: RedisDeliveryQueue,
    private readonly dispatcher: DeliveryDispatcher,
    private readonly redis: Redis,
    private readonly metrics: DeliveryMetrics = deliveryMetrics
  ) {}

  async start(): Promise<void> {
    await this.recoverJobs();
    this.pollTimer = setInterval(() => void this.poll(), env.DELIVERY_QUEUE_POLL_MS);
    this.recoveryTimer = setInterval(() => void this.recoverJobs(), env.DELIVERY_QUEUE_RECOVERY_MS);
    logger.info("Delivery worker started", { workerId: this.workerId });
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  async processNext(now = new Date()): Promise<boolean> {
    const jobId = await this.queue.dequeueDue(now);
    if (!jobId) return false;
    this.metrics.setQueueDepth(await this.queue.size());

    const claimed = await this.prisma.deliveryJob.updateMany({
      where: { id: jobId, status: "AVAILABLE" },
      data: { status: "PROCESSING", lockedAt: now, lockedBy: this.workerId }
    });
    if (claimed.count === 0) return true;

    const job = await this.prisma.deliveryJob.findUnique({
      where: { id: jobId },
      include: { delivery: { include: { notification: true } } }
    });
    if (!job) return true;

    const allowed = await this.consumeThrottle(job.delivery.notification.recipientId, job.delivery.channel);
    if (!allowed) {
      this.metrics.record(job.delivery.channel, "throttled");
      await this.reschedule(job.id, job.delivery.id, job.delivery.attemptCount, "Channel throttle exceeded", now, 1);
      return true;
    }

    const attemptNumber = job.delivery.attemptCount + 1;
    await this.prisma.$transaction([
      this.prisma.notificationDelivery.update({
        where: { id: job.delivery.id },
        data: { status: "PROCESSING", attemptCount: attemptNumber }
      }),
      this.prisma.deliveryAttempt.create({
        data: { deliveryId: job.delivery.id, attemptNumber, status: "PROCESSING" }
      })
    ]);

    let result: DispatchResult;
    const startedAt = Date.now();
    try {
      result = await this.dispatcher.dispatch(job.delivery.channel, job.delivery.notification, job.delivery.id);
    } catch (error) {
      result = { delivered: false, retryable: true, error: error instanceof Error ? error.message : "Unknown provider error" };
    }

    await this.completeAttempt(job.id, job.delivery.id, attemptNumber, job.delivery.maxAttempts, result, now);
    this.metrics.record(
      job.delivery.channel,
      result.delivered ? "delivered" : result.retryable && attemptNumber < job.delivery.maxAttempts ? "retrying" : "dead_letter",
      Date.now() - startedAt
    );
    return true;
  }

  async recoverJobs(now = new Date()): Promise<void> {
    const staleBefore = new Date(now.getTime() - env.DELIVERY_JOB_LEASE_MS);
    await this.prisma.deliveryJob.updateMany({
      where: { status: "PROCESSING", lockedAt: { lt: staleBefore } },
      data: { status: "AVAILABLE", lockedAt: null, lockedBy: null }
    });
    const jobs = await this.prisma.deliveryJob.findMany({
      where: { status: "AVAILABLE" },
      orderBy: { runAt: "asc" },
      take: env.DELIVERY_QUEUE_RECOVERY_BATCH
    });
    await Promise.all(jobs.map((job) => this.queue.enqueue(job.id, job.runAt)));
    this.metrics.setQueueDepth(await this.queue.size());
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (await this.processNext()) {
        // Drain all currently due jobs before sleeping.
      }
    } catch (error) {
      logger.error("Delivery worker poll failed", { error, workerId: this.workerId });
    } finally {
      this.running = false;
    }
  }

  private async completeAttempt(
    jobId: string,
    deliveryId: string,
    attemptNumber: number,
    maxAttempts: number,
    result: DispatchResult,
    now: Date
  ): Promise<void> {
    const metadata = result.metadata as Prisma.InputJsonObject | undefined;
    if (result.delivered) {
      const delivery = await this.prisma.$transaction(async (tx) => {
        await tx.deliveryAttempt.update({
          where: { deliveryId_attemptNumber: { deliveryId, attemptNumber } },
          data: { status: "DELIVERED", providerMessageId: result.providerMessageId, metadata, finishedAt: now }
        });
        await tx.deliveryJob.update({
          where: { id: jobId },
          data: { status: "COMPLETED", lockedAt: null, lockedBy: null }
        });
        return tx.notificationDelivery.update({
          where: { id: deliveryId },
          data: {
            status: "DELIVERED",
            providerMessageId: result.providerMessageId,
            deliveredAt: now,
            lastError: null
          }
        });
      });
      await this.prisma.notification.updateMany({
        where: { id: delivery.notificationId, status: "PENDING" },
        data: { status: "DELIVERED", deliveredAt: now }
      });
      return;
    }

    if (result.retryable && attemptNumber < maxAttempts) {
      await this.reschedule(jobId, deliveryId, attemptNumber, result.error ?? "Delivery failed", now);
      await this.prisma.deliveryAttempt.update({
        where: { deliveryId_attemptNumber: { deliveryId, attemptNumber } },
        data: { status: "RETRYING", error: result.error, metadata, finishedAt: now }
      });
      return;
    }

    await this.prisma.$transaction([
      this.prisma.deliveryAttempt.update({
        where: { deliveryId_attemptNumber: { deliveryId, attemptNumber } },
        data: { status: "DEAD_LETTER", error: result.error, metadata, finishedAt: now }
      }),
      this.prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: "DEAD_LETTER", lastError: result.error }
      }),
      this.prisma.deliveryJob.update({
        where: { id: jobId },
        data: { status: "DEAD_LETTER", lockedAt: null, lockedBy: null }
      })
    ]);
    try {
      await this.queue.deadLetter(jobId, now);
    } catch (error) {
      logger.error("Failed to publish dead-letter marker", { error, jobId, deliveryId });
    }
  }

  private async reschedule(
    jobId: string,
    deliveryId: string,
    attemptNumber: number,
    error: string,
    now: Date,
    delayMultiplier = 2 ** Math.max(attemptNumber - 1, 0)
  ): Promise<void> {
    const runAt = new Date(now.getTime() + env.DELIVERY_RETRY_BASE_MS * delayMultiplier);
    await this.prisma.$transaction([
      this.prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: "RETRYING", nextAttemptAt: runAt, lastError: error }
      }),
      this.prisma.deliveryJob.update({
        where: { id: jobId },
        data: { status: "AVAILABLE", runAt, lockedAt: null, lockedBy: null }
      })
    ]);
    await this.queue.enqueue(jobId, runAt);
  }

  private async consumeThrottle(recipientId: string, channel: string): Promise<boolean> {
    const bucket = Math.floor(Date.now() / 60_000);
    const key = `notifications:throttle:${channel}:${recipientId}:${bucket}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 120);
    return count <= env.DELIVERY_THROTTLE_PER_MINUTE;
  }
}
