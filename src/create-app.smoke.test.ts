import { describe, it, expect, vi } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import { UserRole } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
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

describe("createApp settlement route authorization", () => {
  const JWT_SECRET = "create-app-smoke-secret";

  function token(role: UserRole): string {
    return jwt.sign({ userId: "player-1", role }, JWT_SECRET);
  }

  function appWithMocks() {
    process.env.JWT_SECRET = JWT_SECRET;
    const prisma = {} as PrismaClient;
    const redis = {
      ping: vi.fn().mockResolvedValue("PONG"),
      eval: vi.fn().mockResolvedValue([1, 1]),
    } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const settleDisputedMatch = vi.fn().mockResolvedValue({
      matchId: "m1",
      status: "SETTLED",
      winnerId: "winner-1",
      prizePaid: true,
    });
    return {
      ...createApp({
        prisma,
        redis,
        wsService,
        matchSettlementService: { settleDisputedMatch },
      }),
      settleDisputedMatch,
    };
  }

  it("rejects non-admin callers on legacy match resolve before payout", async () => {
    const { app } = appWithMocks();

    const res = await request(app)
      .post("/api/matches/m1/resolve")
      .set("Authorization", `Bearer ${token(UserRole.PLAYER)}`)
      .send({ finalWinnerId: "winner-1" });

    expect(res.status).toBe(403);
  });

  it("rejects non-admin callers on v1 match resolve before settlement", async () => {
    const { app, settleDisputedMatch } = appWithMocks();

    const res = await request(app)
      .post("/api/v1/matches/m1/resolve")
      .set("Authorization", `Bearer ${token(UserRole.PLAYER)}`)
      .set("Idempotency-Key", "rbac-player")
      .send({ finalWinnerId: "winner-1" });

    expect(res.status).toBe(403);
    expect(settleDisputedMatch).not.toHaveBeenCalled();
  });
});
