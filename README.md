# realtime-notification-hub

Production-oriented real-time notification hub built with Node.js 20+, TypeScript, Express, Socket.io, Redis, PostgreSQL, Prisma, Zod, Winston, and JWT.

## Current Scope

Commit 1 includes:

- Strict TypeScript project setup.
- Express health endpoint at `GET /health`.
- Socket.io server with Redis adapter for horizontal scaling.
- Redis and PostgreSQL services in Docker Compose.
- Dockerfile for the API service.
- Environment validation with Zod.
- JSON logging with Winston.

Commit 2 includes:

- JWT access token issuing and verification.
- Protected HTTP auth middleware.
- Authenticated Socket.io handshakes via `auth.token` or `Authorization: Bearer`.
- In-process user connection registry and per-user socket rooms.

Commit 3 includes:

- Prisma notification schema and migration.
- Database-backed notification creation, listing, and read marking.
- Zod request validation for notification persistence endpoints.

Commit 4 includes:

- Redis Pub/Sub notification event bus.
- Notification creation events published after database persistence.
- Socket.io delivery to per-user rooms through Redis-backed horizontal fanout.

Additional capabilities include:

- Offline delivery queue using persisted `PENDING` notifications.
- Reconnect delivery for pending notifications.
- Socket acknowledgement based delivery marking.
- Redis-backed presence tracking.
- Protected presence query endpoints.
- Redis-backed per-user HTTP rate limiting.

## Local Development

```bash
cp .env.example .env
npm install
npm run dev
```

Start dependencies and API with Docker Compose:

```bash
docker compose up --build
```

The API listens on `http://localhost:3000`.

## Authentication

Issue a development access token:

```bash
curl -X POST http://localhost:3000/auth/token \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"user@example.com\",\"userId\":\"user_123\"}"
```

Check the authenticated user:

```bash
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer <access-token>"
```

## Notifications

Create a persisted notification:

```bash
curl -X POST http://localhost:3000/notifications \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d "{\"recipientId\":\"user_123\",\"type\":\"USER\",\"title\":\"Hello\",\"body\":\"You have a new message\"}"
```

List notifications for the authenticated user:

```bash
curl http://localhost:3000/notifications/me \
  -H "Authorization: Bearer <access-token>"
```

## Socket Smoke Test

Clients can connect with Socket.io using websocket or polling transports. Pass the JWT as `auth.token` or an `Authorization: Bearer` header. On connection the server emits `server:welcome`; clients can send `ping:client` with an acknowledgement callback.

When a notification is created for the connected user, the server emits:

```text
notification:new
```

Clients should acknowledge received notifications:

```ts
socket.on("notification:new", (payload, ack) => {
  ack({ ok: true });
});
```

Notifications remain `PENDING` until at least one local socket acknowledgement is received, then they are marked `DELIVERED`.

## Presence

Check a user's presence:

```bash
curl http://localhost:3000/presence/users/user_123 \
  -H "Authorization: Bearer <access-token>"
```

List online user ids:

```bash
curl http://localhost:3000/presence/online \
  -H "Authorization: Bearer <access-token>"
```
