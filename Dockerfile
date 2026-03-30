# syntax=docker/dockerfile:1

# -----------------------------------------------------------------------------
# Etap 1 — Builder: zależności pełne, generacja Prisma, kompilacja TypeScript
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json tsconfig.json prisma.config.ts ./
COPY prisma ./prisma

RUN npm ci

# prisma.config.ts wymaga DATABASE_URL przy imporcie / generate (brak prawdziwego DB w buildzie)
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"

RUN npm run prisma:generate

COPY src ./src

RUN npm run build

# -----------------------------------------------------------------------------
# Etap 2 — Production: tylko dist, prisma client + prod node_modules
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

ENV NODE_ENV=production

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node prisma ./prisma

# WORKDIR tworzy /app jako root — node musi móc pisać (npm ci → node_modules)
RUN chown node:node /app

USER node

# prod bez devDependencies: prisma.config.ts wymaga dotenv — generacja jest w builderze
RUN npm ci --omit=dev

# Nadpisanie klienta wygenerowanego w builderze (zgodność ze schema + silniki)
COPY --chown=node:node --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --chown=node:node --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

COPY --chown=node:node --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/server.js"]
