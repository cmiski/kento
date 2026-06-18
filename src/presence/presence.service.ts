import type Redis from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import type { AuthUser } from "../auth/auth.types.js";

export type PresenceState = {
  userId: string;
  online: boolean;
  socketCount: number;
  changedAt: string;
};

export class PresenceService {
  constructor(private readonly redis: Redis) {}

  async markOnline(user: AuthUser, socketId: string): Promise<PresenceState> {
    const userSocketsKey = this.userSocketsKey(user.id);

    await this.redis
      .multi()
      .sadd(userSocketsKey, socketId)
      .expire(userSocketsKey, env.PRESENCE_TTL_SECONDS)
      .sadd("presence:online-users", user.id)
      .hset(`presence:user:${user.id}:profile`, {
        email: user.email,
        roles: JSON.stringify(user.roles),
        lastSeenAt: new Date().toISOString()
      })
      .expire(`presence:user:${user.id}:profile`, env.PRESENCE_TTL_SECONDS)
      .exec();

    const state = await this.getPresence(user.id);
    logger.info("User marked online", { userId: user.id, socketId, socketCount: state.socketCount });

    return state;
  }

  async markOffline(userId: string, socketId: string): Promise<PresenceState> {
    const userSocketsKey = this.userSocketsKey(userId);
    await this.redis.srem(userSocketsKey, socketId);

    const socketCount = await this.redis.scard(userSocketsKey);
    if (socketCount === 0) {
      await this.redis.multi().del(userSocketsKey).srem("presence:online-users", userId).exec();
    } else {
      await this.redis.expire(userSocketsKey, env.PRESENCE_TTL_SECONDS);
    }

    const state = {
      userId,
      online: socketCount > 0,
      socketCount,
      changedAt: new Date().toISOString()
    };

    logger.info("User presence changed", { userId, socketId, online: state.online, socketCount });

    return state;
  }

  async getPresence(userId: string): Promise<PresenceState> {
    const socketCount = await this.redis.scard(this.userSocketsKey(userId));

    return {
      userId,
      online: socketCount > 0,
      socketCount,
      changedAt: new Date().toISOString()
    };
  }

  async listOnlineUserIds(): Promise<string[]> {
    return this.redis.smembers("presence:online-users");
  }

  private userSocketsKey(userId: string): string {
    return `presence:user:${userId}:sockets`;
  }
}
