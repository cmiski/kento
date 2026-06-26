# realtime-notification-hub
Intern ID: CITS670

Production-oriented real-time notification hub built with Node.js 20+, TypeScript, Express, Socket.io, Redis, PostgreSQL, Prisma, Zod, Winston, JWT, and Swagger/OpenAPI.

## Architecture

The service is split into HTTP, realtime, persistence, and Redis-backed coordination layers:

- Express exposes auth, notification management, user notification, presence, connection, health, and Swagger endpoints.
- Zod validates every request body, query string, and path parameter handled by the API routes.
- Prisma persists notification records in PostgreSQL with recipient, type, status, template, payload, delivery, and read timestamps.
- Redis powers Socket.io horizontal fanout, notification creation Pub/Sub, presence state, and per-user HTTP rate limiting.
- Socket.io keeps authenticated clients in per-user rooms such as `user:user_123` so delivery can target every active socket for a user.

## Data Flow

1. A caller issues a development JWT through `POST /auth/token`.
2. Admin callers create notifications with `POST /notifications` or render one from a reusable template with `POST /notifications/templates`.
3. `NotificationService` persists the notification first, then publishes a `notifications.created` event through Redis Pub/Sub.
4. The realtime layer receives the event and emits `notification:new` to the recipient's Socket.io room.
5. If any socket acknowledges with `{ "ok": true }`, the notification is marked `DELIVERED`.
6. If no socket acknowledges or delivery times out, the notification remains `PENDING` and is replayed when the user reconnects.
7. Users can list their own notifications with `GET /notifications/me` and mark them read with `PATCH /notifications/{id}/read`.

## Delivery Guarantees

Notifications are persisted before realtime delivery is attempted. Socket delivery is best-effort, acknowledgement-aware, and status-preserving:

- `PENDING`: stored but not yet acknowledged by a recipient socket.
- `DELIVERED`: at least one active recipient socket acknowledged delivery, or an admin simulation marked push delivery successful.
- `READ`: the authenticated recipient marked the notification read.
- `FAILED`: an admin status update or push simulation recorded downstream failure.

Reconnect delivery queries persisted `PENDING` notifications and re-emits them to the user's room. This gives at-least-once delivery semantics, so clients should treat notification IDs as idempotency keys.

## Scaling Strategy

The API can run as multiple stateless Node.js instances:

- Socket.io uses the Redis adapter so room broadcasts can reach sockets connected to any instance.
- Notification creation events use Redis Pub/Sub so any instance can publish and the realtime subscriber can deliver.
- Presence stores per-user socket IDs in Redis with a TTL, avoiding node-local presence as the source of truth.
- HTTP rate limiting increments Redis counters per authenticated user, so limits are shared across instances.
- PostgreSQL remains the durable system of record for notifications.

The in-process `ConnectionRegistry` is intentionally local and only backs `GET /connections/me` for node-local diagnostics.

## Local Development

```bash
cp .env.example .env
npm install
npm run prisma:migrate
npm run dev
```

Start dependencies and API with Docker Compose:

```bash
docker compose up --build
```

The API listens on `http://localhost:3000`.

Useful endpoints:

- Swagger UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`
- Health: `http://localhost:3000/health`

## Authentication

Issue a development user token:

```bash
curl -X POST http://localhost:3000/auth/token \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"user@example.com\",\"userId\":\"user_123\",\"roles\":[\"user\"]}"
```

Issue an admin token:

```bash
curl -X POST http://localhost:3000/auth/token \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@example.com\",\"userId\":\"admin_123\",\"roles\":[\"admin\"]}"
```

Check the authenticated user:

```bash
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer <access-token>"
```

## Notification API

Create a raw notification as an admin:

```bash
curl -X POST http://localhost:3000/notifications \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d "{\"recipientId\":\"user_123\",\"type\":\"USER\",\"title\":\"Hello\",\"body\":\"You have a new message\"}"
```

Create from a template:

```bash
curl -X POST http://localhost:3000/notifications/templates \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d "{\"recipientId\":\"user_123\",\"templateKey\":\"delivery_status\",\"variables\":{\"orderId\":\"ord_123\",\"status\":\"out for delivery\"}}"
```

Admin list and status update:

```bash
curl http://localhost:3000/notifications?recipientId=user_123 \
  -H "Authorization: Bearer <admin-token>"

curl -X PATCH http://localhost:3000/notifications/<notification-id>/status \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"FAILED\"}"
```

Simulate push delivery without a mobile provider:

```bash
curl -X POST http://localhost:3000/notifications/<notification-id>/simulate-push \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"DELIVERED\",\"providerMessageId\":\"push_123\"}"
```

User-facing notification operations:

```bash
curl http://localhost:3000/notifications/me \
  -H "Authorization: Bearer <user-token>"

curl -X PATCH http://localhost:3000/notifications/<notification-id>/read \
  -H "Authorization: Bearer <user-token>"
```

## Socket Clients

Clients can connect with websocket or polling transports. Pass the JWT as `auth.token` or an `Authorization: Bearer` header. On connection the server emits `server:welcome`; clients can send `ping:client` with an acknowledgement callback.

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

Presence is backed by Redis sets with TTL refreshes when sockets connect and disconnect. If an instance dies abruptly, TTL expiry cleans up stale socket state.

## Testing

```bash
npm test
npm run build
```

The tests use Vitest with in-memory doubles for Prisma, Redis, and Socket.io boundaries. They cover auth, notification persistence, template rendering, status updates, simulated push delivery, reconnect delivery, socket acknowledgement handling, Redis-backed presence, and Redis-backed rate limiting.

## Production Deployment

For production, run at least one PostgreSQL database, one Redis deployment, and one or more API instances:

- Set a strong `JWT_SECRET` with rotation handled outside this demo token issuer.
- Run `prisma migrate deploy` before starting new application versions.
- Use TLS and restrict `CORS_ORIGIN` to trusted origins.
- Put instances behind a load balancer that supports websocket upgrades.
- Keep all instances pointed at the same `REDIS_URL` so Socket.io rooms, Pub/Sub, presence, and rate limits are shared.
- Monitor PostgreSQL write latency, Redis Pub/Sub health, Socket.io connection counts, acknowledgement timeout rates, and `PENDING` notification backlog.
- Treat `POST /auth/token` as a development issuer; integrate a real identity provider before exposing this service publicly.

## Environment

See `.env.example` for the required settings:

- `DATABASE_URL`: PostgreSQL connection string used by Prisma.
- `REDIS_URL`: Redis connection string used for Socket.io, Pub/Sub, presence, and rate limits.
- `JWT_SECRET`: HMAC secret for development JWT signing.
- `NOTIFICATION_DELIVERY_TIMEOUT_MS`: Socket acknowledgement timeout.
- `USER_RATE_LIMIT_WINDOW_SECONDS` and `USER_RATE_LIMIT_MAX_REQUESTS`: per-user HTTP rate-limit settings.
- `PRESENCE_TTL_SECONDS`: Redis TTL for presence socket sets and profile data.
# Delivery pipeline

Notifications can target `IN_APP`, `EMAIL`, `PUSH`, and `SMS`. Email, push, and SMS use provider adapter boundaries in `DeliveryDispatcher`; the included adapter is deterministic simulation and should be replaced with production provider clients. User preferences, versioned templates, per-channel delivery records, and every attempt are persisted in PostgreSQL.

Creation is idempotent when `idempotencyKey` is supplied. A transactional database job is written with each delivery, then published to a Redis sorted-set queue. Workers atomically claim due jobs, enforce recipient/channel throttles, retry transient failures with exponential backoff, and mark exhausted or permanent failures as dead letters. Database-backed claims and leases allow multiple worker replicas and recover work after Redis loss or worker termination.

Prometheus-format metrics are exposed at `GET /metrics`. Alert on a sustained increase in `notification_delivery_outcomes_total{outcome="dead_letter"}`, queue depth growth, and absent delivery throughput. Dead-letter transitions also emit error-level structured logs.

Run unit tests with `npm test`. Run the full PostgreSQL/Redis delivery path after applying migrations with:

```powershell
$env:RUN_DELIVERY_INTEGRATION='1'; npm test -- --run test/delivery-pipeline.integration.test.ts
```
