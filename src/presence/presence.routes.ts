import { Router } from "express";
import { z } from "zod";
import type { PresenceService } from "./presence.service.js";

const presenceUserParamsSchema = z.object({
  userId: z.string().min(1)
});

export function createPresenceRouter(presenceService: PresenceService): Router {
  const router = Router();

  router.get("/users/:userId", async (req, res, next) => {
    const params = presenceUserParamsSchema.safeParse(req.params);

    if (!params.success) {
      res.status(400).json({
        error: "Invalid presence user id",
        details: params.error.flatten()
      });
      return;
    }

    try {
      res.status(200).json(await presenceService.getPresence(params.data.userId));
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
