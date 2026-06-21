import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/http/app.js";
import { ConnectionRegistry } from "../src/realtime/connection-registry.js";

const notification = {
  id: "1f7639b3-55b4-42c0-9944-3b8b4067c101",
  recipientId: "user_1",
  type: "USER",
  status: "PENDING",
  title: "Hello",
  body: "Body",
  data: null,
  templateKey: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  deliveredAt: null,
  readAt: null
} as const;

class RateLimitRedis {
  async incr() {
    return 1;
  }

  async expire() {
    return 1;
  }

  async ttl() {
    return 60;
  }
}

function createTestApp() {
  const connectionRegistry = new ConnectionRegistry();
  const notificationService = {
    create: vi.fn(async () => notification),
    createFromTemplate: vi.fn(async () => ({ ...notification, templateKey: "welcome", title: "Welcome, Ada" })),
    list: vi.fn(async () => ({ items: [notification], nextCursor: null })),
    listForRecipient: vi.fn(async () => ({ items: [notification], nextCursor: null })),
    markRead: vi.fn(async () => ({ ...notification, status: "READ" })),
    updateStatus: vi.fn(async () => ({ ...notification, status: "FAILED" })),
    simulatePush: vi.fn(async () => ({ ...notification, status: "DELIVERED" })),
    getPreferences: vi.fn(async () => []),
    updatePreferences: vi.fn(async (_userId, input) => input.preferences),
    createTemplateDefinition: vi.fn(async (input) => ({ id: "template_1", ...input })),
    listTemplateDefinitions: vi.fn(async () => []),
    getDeliveryHistory: vi.fn(async () => ({ ...notification, deliveries: [] }))
  };
  const presenceService = {
    getPresence: vi.fn(async (userId: string) => ({
      userId,
      online: false,
      socketCount: 0,
      changedAt: "2026-01-01T00:00:00.000Z"
    })),
    listOnlineUserIds: vi.fn(async () => ["user_1"])
  };

  return {
    notificationService,
    presenceService,
    app: createApp(
      connectionRegistry,
      notificationService as never,
      presenceService as never,
      new RateLimitRedis() as never
    )
  };
}

async function issueToken(app: ReturnType<typeof createTestApp>["app"], roles: string[]) {
  const response = await request(app)
    .post("/auth/token")
    .send({ userId: roles.includes("admin") ? "admin_1" : "user_1", email: `${roles[0]}@example.com`, roles })
    .expect(201);

  return response.body.accessToken as string;
}

describe("HTTP app", () => {
  it("issues JWTs and protects authenticated routes", async () => {
    const { app } = createTestApp();
    const token = await issueToken(app, ["user"]);

    await request(app).get("/auth/me").expect(401);
    const response = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`).expect(200);

    expect(response.body.user).toMatchObject({ id: "user_1", email: "user@example.com", roles: ["user"] });
  });

  it("documents the API with OpenAPI JSON and Swagger UI", async () => {
    const { app } = createTestApp();

    const spec = await request(app).get("/openapi.json").expect(200);
    expect(spec.body.paths["/notifications/templates"]).toBeDefined();

    await request(app).get("/docs/").expect(200);
  });

  it("separates admin notification management from user-facing operations", async () => {
    const { app, notificationService } = createTestApp();
    const userToken = await issueToken(app, ["user"]);
    const adminToken = await issueToken(app, ["admin"]);

    await request(app)
      .post("/notifications")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ recipientId: "user_1", type: "USER", title: "Hello", body: "Body" })
      .expect(403);

    await request(app)
      .post("/notifications/templates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ recipientId: "user_1", templateKey: "welcome", variables: { name: "Ada" } })
      .expect(201);

    await request(app).get("/notifications/me").set("Authorization", `Bearer ${userToken}`).expect(200);
    await request(app)
      .patch(`/${"notifications"}/${notification.id}/read`)
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);

    expect(notificationService.createFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: "user_1", templateKey: "welcome" })
    );
    expect(notificationService.listForRecipient).toHaveBeenCalledWith("user_1", expect.any(Object));
  });

  it("validates and applies admin status updates and push simulation", async () => {
    const { app, notificationService } = createTestApp();
    const adminToken = await issueToken(app, ["admin"]);

    await request(app)
      .patch(`/notifications/${notification.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "FAILED" })
      .expect(200);

    await request(app)
      .post(`/notifications/${notification.id}/simulate-push`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "DELIVERED", providerMessageId: "push_1" })
      .expect(200);

    await request(app)
      .post("/presence/users/user_1")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(404);

    expect(notificationService.updateStatus).toHaveBeenCalledWith(notification.id, "FAILED");
    expect(notificationService.simulatePush).toHaveBeenCalledWith(notification.id, {
      status: "DELIVERED",
      providerMessageId: "push_1"
    });
  });

  it("manages authenticated channel preferences", async () => {
    const { app, notificationService } = createTestApp();
    const token = await issueToken(app, ["user"]);

    await request(app).get("/notifications/preferences").set("Authorization", `Bearer ${token}`).expect(200);
    await request(app)
      .put("/notifications/preferences")
      .set("Authorization", `Bearer ${token}`)
      .send({ preferences: [{ channel: "EMAIL", enabled: false }] })
      .expect(200);

    expect(notificationService.updatePreferences).toHaveBeenCalledWith("user_1", {
      preferences: [{ channel: "EMAIL", enabled: false }]
    });
  });
});
