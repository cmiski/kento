FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY prisma ./prisma
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
EXPOSE 3000
CMD ["node", "dist/src/server.js"]
