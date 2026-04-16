import jwt from "jsonwebtoken";
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { UserRole } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import type { WebSocketService } from "./services/websocket.service.js";

function signToken(role: UserRole): string {
  return jwt.sign(
    { userId: `user_${role.toLowerCase()}`, role },
    process.env.JWT_SECRET || "dev-secret",
  );
}

function makeInfra() {
  const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
  const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
  return { redis, wsService };
}

describe("admin analytics endpoints (integration)", () => {
  it("GET /api/v1/admin/analytics/overview — 401 bez tokena", async () => {
    const prisma = {
      marketplaceCharge: { aggregate: vi.fn() },
      payout: { aggregate: vi.fn() },
      refund: { aggregate: vi.fn() },
      fraudCheck: { count: vi.fn() },
      connectedAccount: { count: vi.fn() },
      dispute: { count: vi.fn() },
    } as unknown as PrismaClient;
    const { redis, wsService } = makeInfra();
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app).get("/api/v1/admin/analytics/overview");
    expect(res.status).toBe(401);
  });

  it("GET /api/v1/admin/analytics/overview — 403 dla USER", async () => {
    const prisma = {
      marketplaceCharge: { aggregate: vi.fn() },
      payout: { aggregate: vi.fn() },
      refund: { aggregate: vi.fn() },
      fraudCheck: { count: vi.fn() },
      connectedAccount: { count: vi.fn() },
      dispute: { count: vi.fn() },
    } as unknown as PrismaClient;
    const { redis, wsService } = makeInfra();
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .get("/api/v1/admin/analytics/overview")
      .set("Authorization", `Bearer ${signToken(UserRole.PLAYER)}`);
    expect(res.status).toBe(403);
  });

  it("GET /api/v1/admin/analytics/overview — 200 i poprawna struktura dla ADMIN", async () => {
    const prisma = {
      marketplaceCharge: {
        aggregate: vi.fn().mockResolvedValue({ _count: { _all: 3 }, _sum: { amountCents: 12300n } }),
      },
      payout: {
        aggregate: vi.fn().mockResolvedValue({ _count: { _all: 2 }, _sum: { amount: 4500n } }),
      },
      refund: {
        aggregate: vi.fn().mockResolvedValue({ _count: { _all: 1 }, _sum: { amount: 700n } }),
      },
      fraudCheck: {
        count: vi.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(5),
      },
      connectedAccount: { count: vi.fn().mockResolvedValue(11) },
      dispute: { count: vi.fn().mockResolvedValue(2) },
    } as unknown as PrismaClient;
    const { redis, wsService } = makeInfra();
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .get("/api/v1/admin/analytics/overview")
      .set("Authorization", `Bearer ${signToken(UserRole.ADMIN)}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "success",
      data: {
        totalCharges: { count: 3, amountPln: 123 },
        totalPayouts: { count: 2, amountPln: 45 },
        totalRefunds: { count: 1, amountPln: 7 },
        fraudBlocked: 4,
        fraudFlagged: 5,
        activeConnectedAccounts: 11,
        pendingDisputes: 2,
      },
    });
  });

  it("GET /api/v1/admin/analytics/revenue-chart — 401 bez tokena", async () => {
    const prisma = { $queryRaw: vi.fn() } as unknown as PrismaClient;
    const { redis, wsService } = makeInfra();
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app).get("/api/v1/admin/analytics/revenue-chart");
    expect(res.status).toBe(401);
  });

  it("GET /api/v1/admin/analytics/revenue-chart — 403 dla USER", async () => {
    const prisma = { $queryRaw: vi.fn() } as unknown as PrismaClient;
    const { redis, wsService } = makeInfra();
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .get("/api/v1/admin/analytics/revenue-chart")
      .set("Authorization", `Bearer ${signToken(UserRole.PLAYER)}`);
    expect(res.status).toBe(403);
  });

  it("GET /api/v1/admin/analytics/revenue-chart — 200 i poprawna struktura dla ADMIN", async () => {
    const prisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ bucket: new Date("2026-04-01T00:00:00.000Z"), amount: 1000n }])
        .mockResolvedValueOnce([{ bucket: new Date("2026-04-01T00:00:00.000Z"), amount: 300n }])
        .mockResolvedValueOnce([{ bucket: new Date("2026-04-01T00:00:00.000Z"), amount: 100n }]),
    } as unknown as PrismaClient;
    const { redis, wsService } = makeInfra();
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .get("/api/v1/admin/analytics/revenue-chart?from=2026-04-01&to=2026-04-01&granularity=day")
      .set("Authorization", `Bearer ${signToken(UserRole.ADMIN)}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "success",
      data: [
        {
          date: "2026-04-01",
          chargesAmount: 10,
          payoutsAmount: 3,
          refundsAmount: 1,
        },
      ],
    });
  });

  it("GET /api/v1/admin/analytics/fraud-chart — 401 bez tokena", async () => {
    const prisma = { $queryRaw: vi.fn() } as unknown as PrismaClient;
    const { redis, wsService } = makeInfra();
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app).get("/api/v1/admin/analytics/fraud-chart");
    expect(res.status).toBe(401);
  });

  it("GET /api/v1/admin/analytics/fraud-chart — 403 dla USER", async () => {
    const prisma = { $queryRaw: vi.fn() } as unknown as PrismaClient;
    const { redis, wsService } = makeInfra();
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .get("/api/v1/admin/analytics/fraud-chart")
      .set("Authorization", `Bearer ${signToken(UserRole.PLAYER)}`);
    expect(res.status).toBe(403);
  });

  it("GET /api/v1/admin/analytics/fraud-chart — 200 i poprawna struktura dla ADMIN", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        { bucket: new Date("2026-04-10T00:00:00.000Z"), status: "BLOCKED", count: 2n },
        { bucket: new Date("2026-04-10T00:00:00.000Z"), status: "FLAGGED", count: 1n },
        { bucket: new Date("2026-04-10T00:00:00.000Z"), status: "PASSED", count: 5n },
      ]),
    } as unknown as PrismaClient;
    const { redis, wsService } = makeInfra();
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .get("/api/v1/admin/analytics/fraud-chart?from=2026-04-10&to=2026-04-10")
      .set("Authorization", `Bearer ${signToken(UserRole.ADMIN)}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "success",
      data: [{ date: "2026-04-10", blocked: 2, flagged: 1, passed: 5 }],
    });
  });
});
