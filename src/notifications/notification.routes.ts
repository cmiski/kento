import { Router, type Request } from "express";
import type { AuthenticatedRequest } from "../auth/http-auth.js";
import {
  adminListNotificationsQuerySchema,
  createNotificationSchema,
  createTemplateNotificationSchema,
  listNotificationsQuerySchema,
  markNotificationReadSchema,
  notificationIdParamSchema,
  simulatePushSchema,
  updateNotificationStatusSchema
} from "./notification.schemas.js";
import type { NotificationService } from "./notification.service.js";

function getAuthUser(req: Request) {
  return (req as unknown as AuthenticatedRequest).user;
}

function requireAdmin(req: Request, res: { status: (code: number) => { json: (body: unknown) => void } }): boolean {
  const user = getAuthUser(req);

  if (!user.roles.includes("admin")) {
    res.status(403).json({ error: "Admin role required" });
    return false;
  }

  return true;
}

export function createNotificationRouter(notificationService: NotificationService): Router {
  const router = Router();

  router.post("/", async (req, res, next) => {
    if (!requireAdmin(req, res)) {
      return;
    }

    const result = createNotificationSchema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        error: "Invalid notification payload",
        details: result.error.flatten()
      });
      return;
    }

    try {
      const notification = await notificationService.create(result.data);
      res.status(201).json({ notification });
    } catch (error) {
      next(error);
    }
  });

  router.post("/templates", async (req, res, next) => {
    if (!requireAdmin(req, res)) {
      return;
    }

    const result = createTemplateNotificationSchema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        error: "Invalid template notification payload",
        details: result.error.flatten()
      });
      return;
    }

    try {
      const notification = await notificationService.createFromTemplate(result.data);
      res.status(201).json({ notification });
    } catch (error) {
      next(error);
    }
  });

  router.get("/", async (req, res, next) => {
    if (!requireAdmin(req, res)) {
      return;
    }

    const query = adminListNotificationsQuerySchema.safeParse(req.query);

    if (!query.success) {
      res.status(400).json({
        error: "Invalid notification query",
        details: query.error.flatten()
      });
      return;
    }

    try {
      const page = await notificationService.list(query.data);
      res.status(200).json(page);
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", async (req, res, next) => {
    const query = listNotificationsQuerySchema.safeParse(req.query);

    if (!query.success) {
      res.status(400).json({
        error: "Invalid notification query",
        details: query.error.flatten()
      });
      return;
    }

    try {
      const user = getAuthUser(req);
      const page = await notificationService.listForRecipient(user.id, query.data);

      res.status(200).json(page);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:notificationId/status", async (req, res, next) => {
    if (!requireAdmin(req, res)) {
      return;
    }

    const params = notificationIdParamSchema.safeParse(req.params);
    const body = updateNotificationStatusSchema.safeParse(req.body);

    if (!params.success || !body.success) {
      res.status(400).json({
        error: "Invalid notification status payload",
        details: {
          params: params.success ? undefined : params.error.flatten(),
          body: body.success ? undefined : body.error.flatten()
        }
      });
      return;
    }

    try {
      const notification = await notificationService.updateStatus(params.data.notificationId, body.data.status);

      if (!notification) {
        res.status(404).json({ error: "Notification not found" });
        return;
      }

      res.status(200).json({ notification });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:notificationId/simulate-push", async (req, res, next) => {
    if (!requireAdmin(req, res)) {
      return;
    }

    const params = notificationIdParamSchema.safeParse(req.params);
    const body = simulatePushSchema.safeParse(req.body);

    if (!params.success || !body.success) {
      res.status(400).json({
        error: "Invalid push simulation payload",
        details: {
          params: params.success ? undefined : params.error.flatten(),
          body: body.success ? undefined : body.error.flatten()
        }
      });
      return;
    }

    try {
      const notification = await notificationService.simulatePush(params.data.notificationId, body.data);

      if (!notification) {
        res.status(404).json({ error: "Notification not found" });
        return;
      }

      res.status(200).json({
        simulated: true,
        notification
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:notificationId/read", async (req, res, next) => {
    const params = markNotificationReadSchema.safeParse(req.params);

    if (!params.success) {
      res.status(400).json({
        error: "Invalid notification id",
        details: params.error.flatten()
      });
      return;
    }

    try {
      const user = getAuthUser(req);
      const notification = await notificationService.markRead(params.data.notificationId, user.id);

      if (!notification) {
        res.status(404).json({ error: "Notification not found" });
        return;
      }

      res.status(200).json({ notification });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
