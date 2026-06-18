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

## Socket Smoke Test

Clients can connect with Socket.io using websocket or polling transports. On connection the server emits `server:welcome`; clients can send `ping:client` with an acknowledgement callback.
