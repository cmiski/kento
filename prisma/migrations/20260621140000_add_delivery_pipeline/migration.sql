CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'PUSH', 'SMS');
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'PROCESSING', 'DELIVERED', 'RETRYING', 'FAILED', 'DEAD_LETTER', 'SKIPPED');
CREATE TYPE "DeliveryJobStatus" AS ENUM ('AVAILABLE', 'PROCESSING', 'COMPLETED', 'DEAD_LETTER');

ALTER TABLE "Notification"
ADD COLUMN "templateVersion" INTEGER,
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "scheduledAt" TIMESTAMP(3),
ADD COLUMN "channels" "NotificationChannel"[] NOT NULL DEFAULT ARRAY['IN_APP']::"NotificationChannel"[];

CREATE UNIQUE INDEX "Notification_idempotencyKey_key" ON "Notification"("idempotencyKey");

CREATE TABLE "ChannelPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "destination" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationTemplate" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL,
  "providerMessageId" TEXT,
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryAttempt" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" "DeliveryStatus" NOT NULL,
  "providerMessageId" TEXT,
  "error" TEXT,
  "metadata" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryJob" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "status" "DeliveryJobStatus" NOT NULL DEFAULT 'AVAILABLE',
  "runAt" TIMESTAMP(3) NOT NULL,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelPreference_userId_channel_key" ON "ChannelPreference"("userId", "channel");
CREATE INDEX "ChannelPreference_userId_idx" ON "ChannelPreference"("userId");
CREATE UNIQUE INDEX "NotificationTemplate_key_version_channel_key" ON "NotificationTemplate"("key", "version", "channel");
CREATE INDEX "NotificationTemplate_key_active_idx" ON "NotificationTemplate"("key", "active");
CREATE UNIQUE INDEX "NotificationDelivery_notificationId_channel_key" ON "NotificationDelivery"("notificationId", "channel");
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");
CREATE UNIQUE INDEX "DeliveryAttempt_deliveryId_attemptNumber_key" ON "DeliveryAttempt"("deliveryId", "attemptNumber");
CREATE INDEX "DeliveryAttempt_deliveryId_startedAt_idx" ON "DeliveryAttempt"("deliveryId", "startedAt");
CREATE UNIQUE INDEX "DeliveryJob_deliveryId_key" ON "DeliveryJob"("deliveryId");
CREATE INDEX "DeliveryJob_status_runAt_idx" ON "DeliveryJob"("status", "runAt");
CREATE INDEX "DeliveryJob_status_lockedAt_idx" ON "DeliveryJob"("status", "lockedAt");

ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "NotificationDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryJob" ADD CONSTRAINT "DeliveryJob_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "NotificationDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
