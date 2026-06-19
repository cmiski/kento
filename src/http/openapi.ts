export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Realtime Notification Hub API",
    version: "0.1.0",
    description: "HTTP API for auth, notification management, delivery simulation, presence, and connection state."
  },
  servers: [{ url: "http://localhost:3000" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT"
      }
    },
    schemas: {
      Notification: {
        type: "object",
        required: ["id", "recipientId", "type", "status", "title", "body", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          recipientId: { type: "string" },
          type: { type: "string", enum: ["USER", "EVENT", "SYSTEM"] },
          status: { type: "string", enum: ["PENDING", "DELIVERED", "READ", "FAILED"] },
          title: { type: "string" },
          body: { type: "string" },
          data: { type: "object", nullable: true, additionalProperties: true },
          templateKey: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          deliveredAt: { type: "string", format: "date-time", nullable: true },
          readAt: { type: "string", format: "date-time", nullable: true }
        }
      },
      NotificationPage: {
        type: "object",
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/Notification" } },
          nextCursor: { type: "string", nullable: true }
        }
      }
    }
  },
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        responses: { "200": { description: "Service is healthy" } }
      }
    },
    "/auth/token": {
      post: {
        summary: "Issue a development JWT",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: {
                  userId: { type: "string" },
                  email: { type: "string", format: "email" },
                  roles: { type: "array", items: { type: "string" }, default: ["user"] }
                }
              }
            }
          }
        },
        responses: { "201": { description: "Token issued" }, "400": { description: "Invalid payload" } }
      }
    },
    "/auth/me": {
      get: {
        summary: "Return the authenticated user",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Authenticated user" }, "401": { description: "Unauthorized" } }
      }
    },
    "/notifications": {
      get: {
        summary: "Admin list notifications",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "recipientId", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["PENDING", "DELIVERED", "READ", "FAILED"] } },
          { name: "type", in: "query", schema: { type: "string", enum: ["USER", "EVENT", "SYSTEM"] } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
          { name: "cursor", in: "query", schema: { type: "string" } }
        ],
        responses: { "200": { description: "Notification page" }, "403": { description: "Admin role required" } }
      },
      post: {
        summary: "Admin create a raw notification",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["recipientId", "type", "title", "body"],
                properties: {
                  recipientId: { type: "string" },
                  type: { type: "string", enum: ["USER", "EVENT", "SYSTEM"] },
                  title: { type: "string", maxLength: 160 },
                  body: { type: "string", maxLength: 4000 },
                  data: { type: "object", additionalProperties: true },
                  templateKey: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "201": { description: "Notification persisted" }, "400": { description: "Invalid payload" } }
      }
    },
    "/notifications/templates": {
      post: {
        summary: "Admin create a notification from a reusable template",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["recipientId", "templateKey"],
                properties: {
                  recipientId: { type: "string" },
                  type: { type: "string", enum: ["USER", "EVENT", "SYSTEM"], default: "SYSTEM" },
                  templateKey: {
                    type: "string",
                    enum: ["welcome", "delivery_status", "security_alert", "system_maintenance"]
                  },
                  variables: { type: "object", additionalProperties: { type: "string" } },
                  data: { type: "object", additionalProperties: true }
                }
              }
            }
          }
        },
        responses: { "201": { description: "Rendered notification persisted" } }
      }
    },
    "/notifications/me": {
      get: {
        summary: "List notifications for the authenticated user",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Notification page" } }
      }
    },
    "/notifications/{notificationId}/read": {
      patch: {
        summary: "Mark one of the authenticated user's notifications read",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "notificationId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Notification marked read" }, "404": { description: "Not found" } }
      }
    },
    "/notifications/{notificationId}/status": {
      patch: {
        summary: "Admin update notification status",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "notificationId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["status"], properties: { status: { type: "string" } } }
            }
          }
        },
        responses: { "200": { description: "Notification status updated" } }
      }
    },
    "/notifications/{notificationId}/simulate-push": {
      post: {
        summary: "Admin simulate downstream push delivery",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "notificationId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string", enum: ["DELIVERED", "FAILED"], default: "DELIVERED" },
                  providerMessageId: { type: "string" },
                  error: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Push delivery simulated" }, "404": { description: "Not found" } }
      }
    },
    "/presence/users/{userId}": {
      get: {
        summary: "Get a user's Redis-backed presence",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Presence state" } }
      }
    },
    "/presence/online": {
      get: {
        summary: "List online user ids",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Online users" } }
      }
    },
    "/connections/me": {
      get: {
        summary: "Get in-process sockets for the authenticated user on this node",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Connection snapshot" } }
      }
    }
  }
} as const;
