import jwt from "jsonwebtoken";
import { UserRole, type PrismaClient } from "@prisma/client";
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import type { WebSocketService } from "./services/websocket.service.js";

const JWT_SECRET = "create-app-smoke-secret";

function bearer(userId: string, role: UserRole = UserRole.PLAYER): string {
  return jwt.sign({ userId, role }, JWT_SECRET);
}

function redis(): Redis {
  return { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
}

function ws(): WebSocketService {
  return { notifyWallet: vi.fn() } as unknown as WebSocketService;
}

beforeEach(() => {
  process.env.JWT_SECRET = JWT_SECRET;
});

describe("createApp health endpoints", () => {
  it("GET /health returns ok", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([1]),
    } as unknown as PrismaClient;

    const { app } = createApp({ prisma, redis: redis(), wsService: ws() });

    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /health/ready returns ready when DB and Redis respond", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([1]),
    } as unknown as PrismaClient;
    const healthyRedis = redis();

    const { app } = createApp({ prisma, redis: healthyRedis, wsService: ws() });

    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready" });
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(healthyRedis.ping).toHaveBeenCalled();
  });

  it("GET /health/ready returns 503 when Redis ping fails", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([1]),
    } as unknown as PrismaClient;
    const failingRedis = { ping: vi.fn().mockResolvedValue("NOPE") } as unknown as Redis;

    const { app } = createApp({ prisma, redis: failingRedis, wsService: ws() });

    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "not_ready", code: "SERVICE_UNAVAILABLE" });
  });
});

describe("createApp critical legacy route guards", () => {
  it("rejects player JWT before legacy wallet deposit can mint funds", async () => {
    const tx = {
      transaction: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "tx_dep", amount: 100n, referenceId: "r1" }),
      },
      wallet: {
        update: vi.fn().mockResolvedValue({ id: "wallet_player" }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const { app } = createApp({ prisma, redis: redis(), wsService: ws() });

    const res = await request(app)
      .post("/api/wallet/deposit")
      .set("Authorization", `Bearer ${bearer("player_1")}`)
      .send({ amount: "100", referenceId: "self-mint-1" });

    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });

  it("rejects player JWT before legacy match resolve can settle prizes", async () => {
    const match = {
      id: "match_1",
      tournamentId: "tournament_1",
      status: "DISPUTED",
      winnerId: null,
      playerAId: "player_a",
      playerBId: "player_b",
      awardsTournamentPrize: false,
      tournament: {
        entryFee: 0n,
        participants: [],
        organizer: { wallet: null },
      },
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      match: {
        findUnique: vi.fn().mockResolvedValue(match),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      tournament: {
        findUnique: vi.fn().mockResolvedValue({ id: "tournament_1", status: "COMPLETED" }),
        update: vi.fn().mockResolvedValue({}),
      },
      wallet: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
      transaction: {
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const { app } = createApp({ prisma, redis: redis(), wsService: ws() });

    const res = await request(app)
      .post("/api/matches/match_1/resolve")
      .set("Authorization", `Bearer ${bearer("player_a")}`)
      .send({ finalWinnerId: "player_a" });

    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.match.update).not.toHaveBeenCalled();
  });
});
