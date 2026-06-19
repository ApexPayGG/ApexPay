import { describe, it, expect, vi } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { UserRole } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import type { WebSocketService } from "./services/websocket.service.js";

const JWT_SECRET = "create-app-smoke-secret";

function token(role: UserRole): string {
  return jwt.sign({ userId: `user-${role.toLowerCase()}`, role }, JWT_SECRET);
}

function createRedis(): Redis {
  const store = new Map<string, string>();
  return {
    ping: vi.fn().mockResolvedValue("PONG"),
    eval: vi.fn(
      (_script: string, numKeys: number, ...rest: string[]) => {
        if (
          numKeys === 1 &&
          rest[0]?.startsWith("ratelimit:sliding:v1:resolve:user:")
        ) {
          return Promise.resolve([1, 1]);
        }
        if (numKeys !== 2 || rest.length < 2) {
          return Promise.resolve(null);
        }
        const stateKey = rest[0];
        const bodyKey = rest[1];
        const state = store.get(stateKey);
        if (state === undefined) {
          store.set(stateKey, "PENDING");
          return Promise.resolve("ACQUIRED");
        }
        if (state === "PENDING") {
          return Promise.resolve("PENDING");
        }
        return Promise.resolve(store.get(bodyKey) ?? "");
      },
    ),
    multi: vi.fn(() => {
      const ops: Array<{ key: string; value: string }> = [];
      return {
        set(key: string, value: string) {
          ops.push({ key, value });
          return this;
        },
        exec() {
          for (const op of ops) {
            store.set(op.key, op.value);
          }
          return Promise.resolve([]);
        },
      };
    }),
    del: vi.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (store.delete(key)) {
          deleted += 1;
        }
      }
      return deleted;
    }),
  } as unknown as Redis;
}

function createDepositPrisma() {
  const tx = {
    transaction: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: "txn-self-mint",
        walletId: "wallet-player",
        amount: 999_999n,
        referenceId: "manual-self-mint",
        type: "DEPOSIT",
        createdAt: new Date("2026-06-19T11:00:00.000Z"),
      }),
    },
    wallet: {
      update: vi.fn().mockResolvedValue({ id: "wallet-player" }),
    },
  };
  return {
    prisma: {
      $queryRaw: vi.fn().mockResolvedValue([1]),
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    } as unknown as PrismaClient,
    tx,
  };
}

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

describe("createApp critical money route guards", () => {
  it("rejects player JWTs on legacy wallet deposit before minting funds", async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const { prisma, tx } = createDepositPrisma();
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({
      prisma,
      redis: createRedis(),
      wsService,
    });

    const res = await request(app)
      .post("/api/wallet/deposit")
      .set("Authorization", `Bearer ${token(UserRole.PLAYER)}`)
      .send({ amount: "999999", referenceId: "manual-self-mint" });

    expect(res.status).toBe(403);
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it("rejects player JWTs on legacy match resolve before settlement", async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([1]),
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const { app } = createApp({
      prisma,
      redis: createRedis(),
      wsService: { notifyWallet: vi.fn() } as unknown as WebSocketService,
    });

    const res = await request(app)
      .post("/api/matches/match-1/resolve")
      .set("Authorization", `Bearer ${token(UserRole.PLAYER)}`)
      .send({ finalWinnerId: "player-a" });

    expect(res.status).toBe(403);
    expect((prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction).not.toHaveBeenCalled();
  });

  it("rejects player JWTs on v1 match resolve before settlement", async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const settleDisputedMatch = vi.fn().mockResolvedValue({
      matchId: "match-1",
      status: "SETTLED",
      winnerId: "player-a",
      prizePaid: true,
    });
    const { app } = createApp({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([1]) } as unknown as PrismaClient,
      redis: createRedis(),
      wsService: { notifyWallet: vi.fn() } as unknown as WebSocketService,
      matchSettlementService: { settleDisputedMatch },
    });

    const res = await request(app)
      .post("/api/v1/matches/match-1/resolve")
      .set("Authorization", `Bearer ${token(UserRole.PLAYER)}`)
      .set("Idempotency-Key", "player-resolve")
      .send({ finalWinnerId: "player-a" });

    expect(res.status).toBe(403);
    expect(settleDisputedMatch).not.toHaveBeenCalled();
  });
});
