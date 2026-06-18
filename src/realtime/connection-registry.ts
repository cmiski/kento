import type { AuthUser } from "../auth/auth.types.js";

export type UserConnection = {
  socketId: string;
  user: AuthUser;
  connectedAt: Date;
};

export type UserConnectionSnapshot = {
  userId: string;
  sockets: Array<{
    socketId: string;
    connectedAt: string;
  }>;
};

export class ConnectionRegistry {
  private readonly byUserId = new Map<string, Map<string, UserConnection>>();
  private readonly bySocketId = new Map<string, UserConnection>();

  add(socketId: string, user: AuthUser): UserConnection {
    const connection: UserConnection = {
      socketId,
      user,
      connectedAt: new Date()
    };

    const userConnections = this.byUserId.get(user.id) ?? new Map<string, UserConnection>();
    userConnections.set(socketId, connection);
    this.byUserId.set(user.id, userConnections);
    this.bySocketId.set(socketId, connection);

    return connection;
  }

  remove(socketId: string): UserConnection | null {
    const connection = this.bySocketId.get(socketId);
    if (!connection) {
      return null;
    }

    this.bySocketId.delete(socketId);
    const userConnections = this.byUserId.get(connection.user.id);
    userConnections?.delete(socketId);

    if (userConnections?.size === 0) {
      this.byUserId.delete(connection.user.id);
    }

    return connection;
  }

  getUserSocketCount(userId: string): number {
    return this.byUserId.get(userId)?.size ?? 0;
  }

  isUserConnected(userId: string): boolean {
    return this.getUserSocketCount(userId) > 0;
  }

  snapshotForUser(userId: string): UserConnectionSnapshot {
    const connections = Array.from(this.byUserId.get(userId)?.values() ?? []);

    return {
      userId,
      sockets: connections.map((connection) => ({
        socketId: connection.socketId,
        connectedAt: connection.connectedAt.toISOString()
      }))
    };
  }
}
