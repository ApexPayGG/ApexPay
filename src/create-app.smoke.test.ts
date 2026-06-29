import { describe, it, expect, vi } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import { UserRole, type PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import type { WebSocketService } from "./services/websocket.service.js";

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

describe("createApp critical route guards", () => {
  it("rejects PLAYER JWT before legacy match resolve can settle payouts", async () => {
    const secret = "legacy-resolve-route-test-secret";
    vi.stubEnv("JWT_SECRET", secret);
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([1]),
      $transaction: vi.fn(async () => {
        throw new Error("legacy resolve settlement should not run for PLAYER");
      }),
    } as unknown as PrismaClient;
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const token = jwt.sign({ userId: "player_1", role: UserRole.PLAYER }, secret);

    const { app } = createApp({ prisma, redis, wsService });
    const res = await request(app)
      .post("/api/matches/match_1/resolve")
      .set("Authorization", `Bearer ${token}`)
      .send({ finalWinnerId: "player_1" });

    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("rejects PLAYER JWT before v1 match resolve reaches HMAC-idempotent settlement", async () => {
    const secret = "v1-resolve-route-test-secret";
    vi.stubEnv("JWT_SECRET", secret);
    vi.stubEnv("API_SECRET_KEYS", "");
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([1]),
    } as unknown as PrismaClient;
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const settleDisputedMatch = vi.fn().mockResolvedValue({
      matchId: "match_1",
      status: "SETTLED",
      winnerId: "player_1",
      prizePaid: true,
    });
    const token = jwt.sign({ userId: "player_1", role: UserRole.PLAYER }, secret);

    const { app } = createApp({
      prisma,
      redis,
      wsService,
      matchSettlementService: { settleDisputedMatch },
    });
    const res = await request(app)
      .post("/api/v1/matches/match_1/resolve")
      .set("Authorization", `Bearer ${token}`)
      .send({ finalWinnerId: "player_1" });

    expect(res.status).toBe(403);
    expect(settleDisputedMatch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
