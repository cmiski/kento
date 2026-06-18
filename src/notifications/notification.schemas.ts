import { z } from "zod";

const jsonLiteralSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type JsonLiteral = z.infer<typeof jsonLiteralSchema>;
type JsonValue = JsonLiteral | { [key: string]: JsonValue } | JsonValue[];
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonLiteralSchema, z.array(jsonValueSchema), z.record(jsonValueSchema)])
);

export const notificationTypeSchema = z.enum(["USER", "EVENT", "SYSTEM"]);
export const notificationStatusSchema = z.enum(["PENDING", "DELIVERED", "READ", "FAILED"]);

export const createNotificationSchema = z.object({
  recipientId: z.string().min(1),
  type: notificationTypeSchema,
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(4000),
  data: z.record(jsonValueSchema).optional(),
  templateKey: z.string().min(1).max(120).optional()
});

export const listNotificationsQuerySchema = z.object({
  status: notificationStatusSchema.optional(),
  type: notificationTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional()
});

export const markNotificationReadSchema = z.object({
  notificationId: z.string().uuid()
});

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
