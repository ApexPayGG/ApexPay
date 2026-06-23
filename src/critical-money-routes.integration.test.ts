import jwt from "jsonwebtoken";
import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import { UserRole } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import type { WebSocketService } from "./services/websocket.service.js";

describe("critical money route authorization", () => {
  const JWT_SECRET = "critical-money-routes-secret";

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    delete process.env.API_SECRET_KEY;
    delete process.env.API_SECRET_KEYS;
  });

  function bearer(role: UserRole): string {
    return jwt.sign({ userId: "player-1", role }, JWT_SECRET);
  }

  function redis(): Redis {
    return {
      ping: vi.fn().mockResolvedValue("PONG"),
      eval: vi.fn().mockResolvedValue([1, 1]),
    } as unknown as Redis;
  }

  function ws(): WebSocketService {
    return { notifyWallet: vi.fn() } as unknown as WebSocketService;
  }

  it("rejects player JWTs on legacy wallet deposit before crediting funds", async () => {
    const tx = {
      transaction: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: "txn-deposit",
          walletId: "wallet-player",
          amount: 5000n,
          referenceId: "manual-mint-1",
          type: "DEPOSIT",
          createdAt: new Date(),
        }),
      },
      wallet: {
        update: vi.fn().mockResolvedValue({ id: "wallet-player" }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const { app } = createApp({ prisma, redis: redis(), wsService: ws() });

    const res = await request(app)
      .post("/api/wallet/deposit")
      .set("Authorization", `Bearer ${bearer(UserRole.PLAYER)}`)
      .send({ amount: "5000", referenceId: "manual-mint-1" });

    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects player JWTs on legacy match resolve before settlement writes", async () => {
    const prisma = {
      $transaction: vi.fn().mockResolvedValue(undefined),
    } as unknown as PrismaClient;
    const { app } = createApp({ prisma, redis: redis(), wsService: ws() });

    const res = await request(app)
      .post("/api/matches/match-1/resolve")
      .set("Authorization", `Bearer ${bearer(UserRole.PLAYER)}`)
      .send({ finalWinnerId: "player-1" });

    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects player JWTs on v1 match resolve before idempotency or settlement", async () => {
    const settleDisputedMatch = vi.fn().mockResolvedValue({
      matchId: "match-1",
      status: "SETTLED" as const,
      winnerId: "player-1",
      prizePaid: true,
    });
    const redisClient = redis();
    const { app } = createApp({
      prisma: {} as PrismaClient,
      redis: redisClient,
      wsService: ws(),
      matchSettlementService: { settleDisputedMatch },
    });

    const res = await request(app)
      .post("/api/v1/matches/match-1/resolve")
      .set("Authorization", `Bearer ${bearer(UserRole.PLAYER)}`)
      .set("Idempotency-Key", "player-resolve-1")
      .send({ finalWinnerId: "player-1" });

    expect(res.status).toBe(403);
    expect(redisClient.eval).not.toHaveBeenCalled();
    expect(settleDisputedMatch).not.toHaveBeenCalled();
  });
});
