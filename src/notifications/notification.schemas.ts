import { z } from "zod";

const jsonLiteralSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type JsonLiteral = z.infer<typeof jsonLiteralSchema>;
type JsonValue = JsonLiteral | { [key: string]: JsonValue } | JsonValue[];
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonLiteralSchema, z.array(jsonValueSchema), z.record(jsonValueSchema)])
);

export const notificationTypeSchema = z.enum(["USER", "EVENT", "SYSTEM"]);
export const notificationStatusSchema = z.enum(["PENDING", "DELIVERED", "READ", "FAILED"]);

export const notificationTemplateKeySchema = z.enum([
  "welcome",
  "delivery_status",
  "security_alert",
  "system_maintenance"
]);

export const createNotificationSchema = z.object({
  recipientId: z.string().min(1),
  type: notificationTypeSchema,
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(4000),
  data: z.record(jsonValueSchema).optional(),
  templateKey: z.string().min(1).max(120).optional()
});

export const createTemplateNotificationSchema = z.object({
  recipientId: z.string().min(1),
  type: notificationTypeSchema.default("SYSTEM"),
  templateKey: notificationTemplateKeySchema,
  variables: z.record(z.string().min(1), z.string().max(500)).default({}),
  data: z.record(jsonValueSchema).optional()
});

export const listNotificationsQuerySchema = z.object({
  status: notificationStatusSchema.optional(),
  type: notificationTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional()
});

export const adminListNotificationsQuerySchema = listNotificationsQuerySchema.extend({
  recipientId: z.string().min(1).optional()
});

export const markNotificationReadSchema = z.object({
  notificationId: z.string().uuid()
});

export const notificationIdParamSchema = z.object({
  notificationId: z.string().uuid()
});

export const updateNotificationStatusSchema = z.object({
  status: notificationStatusSchema
});

export const simulatePushSchema = z.object({
  status: z.enum(["DELIVERED", "FAILED"]).default("DELIVERED"),
  providerMessageId: z.string().min(1).max(160).optional(),
  error: z.string().min(1).max(1000).optional()
});

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
export type CreateTemplateNotificationInput = z.infer<typeof createTemplateNotificationSchema>;
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type AdminListNotificationsQuery = z.infer<typeof adminListNotificationsQuerySchema>;
export type NotificationStatusUpdate = z.infer<typeof updateNotificationStatusSchema>;
export type SimulatePushInput = z.infer<typeof simulatePushSchema>;
