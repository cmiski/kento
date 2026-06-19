import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AuthUser } from "../src/auth/auth.types.js";
import { createUserRateLimiter } from "../src/http/rate-limit.js";
import { PresenceService } from "../src/presence/presence.service.js";

class MemoryRedis {
  private readonly sets = new Map<string, Set<string>>();
  private readonly values = new Map<string, number>();

  multi() {
    const operations: Array<() => void> = [];
    const tx = {
      sadd: (key: string, value: string) => {
        operations.push(() => {
          void this.sadd(key, value);
        });
        return tx;
      },
      expire: () => tx,
      hset: () => tx,
      del: (key: string) => {
        operations.push(() => {
          void this.del(key);
        });
        return tx;
      },
      srem: (key: string, value: string) => {
        operations.push(() => {
          void this.srem(key, value);
        });
        return tx;
      },
      exec: async () => {
        operations.forEach((operation) => operation());
      }
    };

    return tx;
  }

  async sadd(key: string, value: string) {
    const set = this.sets.get(key) ?? new Set<string>();
    set.add(value);
    this.sets.set(key, set);
  }

  async srem(key: string, value: string) {
    this.sets.get(key)?.delete(value);
  }

  async scard(key: string) {
    return this.sets.get(key)?.size ?? 0;
  }

  async smembers(key: string) {
    return Array.from(this.sets.get(key) ?? []);
  }

  async del(key: string) {
    this.sets.delete(key);
  }

  async expire() {
    return 1;
  }

  async hset() {
    return 1;
  }

  async incr(key: string) {
    const next = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, next);
    return next;
  }

  async ttl() {
    return 60;
  }
}

const user: AuthUser = {
  id: "user_1",
  email: "user@example.com",
  roles: ["user"]
};

describe("PresenceService and rate limiting", () => {
  it("tracks Redis-backed online state across multiple sockets", async () => {
    const redis = new MemoryRedis();
    const presence = new PresenceService(redis as never);

    await presence.markOnline(user, "socket_1");
    const online = await presence.markOnline(user, "socket_2");

    expect(online).toMatchObject({ userId: "user_1", online: true, socketCount: 2 });
    expect(await presence.listOnlineUserIds()).toEqual(["user_1"]);

    const stillOnline = await presence.markOffline("user_1", "socket_1");
    expect(stillOnline).toMatchObject({ online: true, socketCount: 1 });

    const offline = await presence.markOffline("user_1", "socket_2");
    expect(offline).toMatchObject({ online: false, socketCount: 0 });
  });

  it("enforces the per-user Redis-backed HTTP rate limit", async () => {
    const app = express();
    const redis = new MemoryRedis();
    app.use((req, _res, next) => {
      (req as never as { user: AuthUser }).user = user;
      next();
    });
    app.use(createUserRateLimiter(redis as never));
    app.get("/limited", (_req, res) => res.status(200).json({ ok: true }));

    await request(app).get("/limited").expect(200);
    await request(app).get("/limited").expect(200);
    const response = await request(app).get("/limited").expect(429);

    expect(response.body).toEqual({ error: "Rate limit exceeded", retryAfterSeconds: 60 });
  });
});
