import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import type { WebSocketService } from "./services/websocket.service.js";

const JWT_SECRET = "create-app-smoke-secret";

function token(role?: UserRole): string {
  return jwt.sign(
    role === undefined
      ? { userId: "player-1" }
      : { userId: "admin-1", role },
    JWT_SECRET,
  );
}

function createRedis(): Redis {
  return {
    ping: vi.fn().mockResolvedValue("PONG"),
    eval: vi.fn().mockResolvedValue([1, 1]),
  } as unknown as Redis;
}

function createWs(): WebSocketService {
  return { notifyWallet: vi.fn() } as unknown as WebSocketService;
}

beforeEach(() => {
  vi.stubEnv("JWT_SECRET", JWT_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createApp health endpoints", () => {
  it("GET /health returns ok", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([1]),
    } as unknown as PrismaClient;
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;

    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /health/ready returns ready when DB and Redis respond", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([1]),
    } as unknown as PrismaClient;
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;

    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready" });
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(redis.ping).toHaveBeenCalled();
  });

  it("GET /health/ready returns 503 when Redis ping fails", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([1]),
    } as unknown as PrismaClient;
    const redis = { ping: vi.fn().mockResolvedValue("NOPE") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;

    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "not_ready", code: "SERVICE_UNAVAILABLE" });
  });
});

describe("createApp critical route guardrails", () => {
  it("blocks normal users from legacy wallet deposit", async () => {
    const prisma = {
      $transaction: vi.fn().mockRejectedValue(new Error("deposit handler reached")),
    } as unknown as PrismaClient;
    const { app } = createApp({ prisma, redis: createRedis(), wsService: createWs() });

    const res = await request(app)
      .post("/api/wallet/deposit")
      .set("Authorization", `Bearer ${token()}`)
      .send({ amount: "999999", referenceId: "manual-mint" });

    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("blocks normal users from legacy dispute resolution payouts", async () => {
    const prisma = {
      $transaction: vi.fn().mockRejectedValue(new Error("resolve handler reached")),
    } as unknown as PrismaClient;
    const { app } = createApp({ prisma, redis: createRedis(), wsService: createWs() });

    const res = await request(app)
      .post("/api/matches/match-1/resolve")
      .set("Authorization", `Bearer ${token()}`)
      .send({ finalWinnerId: "player-1" });

    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("blocks non-admin JWTs from v1 dispute resolution", async () => {
    const settleDisputedMatch = vi.fn().mockResolvedValue({
      matchId: "match-1",
      status: "SETTLED" as const,
      winnerId: "player-1",
      prizePaid: true,
    });
    const { app } = createApp({
      prisma: {} as PrismaClient,
      redis: createRedis(),
      wsService: createWs(),
      matchSettlementService: { settleDisputedMatch },
    });

    const res = await request(app)
      .post("/api/v1/matches/match-1/resolve")
      .set("Authorization", `Bearer ${token()}`)
      .set("Idempotency-Key", "guardrail")
      .send({ finalWinnerId: "player-1" });

    expect(res.status).toBe(403);
    expect(settleDisputedMatch).not.toHaveBeenCalled();
  });
});
