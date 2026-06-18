import { Router } from "express";
import type { PresenceService } from "./presence.service.js";

export function createPresenceRouter(presenceService: PresenceService): Router {
  const router = Router();

  router.get("/users/:userId", async (req, res, next) => {
    try {
      res.status(200).json(await presenceService.getPresence(req.params.userId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/online", async (_req, res, next) => {
    try {
      res.status(200).json({
        userIds: await presenceService.listOnlineUserIds()
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
