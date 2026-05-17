import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { UserRole, type PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import type { WebSocketService } from "./services/websocket.service.js";

function makeRedis(): Redis {
  return {
    ping: vi.fn().mockResolvedValue("PONG"),
    incr: vi.fn().mockResolvedValue(1),
    pexpire: vi.fn().mockResolvedValue(1),
    pttl: vi.fn().mockResolvedValue(60_000),
  } as unknown as Redis;
}

function makePrisma(): PrismaClient {
  const tx = {
    transaction: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: "txn_dep_1",
        walletId: "wallet_player",
        amount: 5000n,
        referenceId: "manual-player-deposit",
        type: "DEPOSIT",
        createdAt: new Date("2026-05-17T11:00:00.000Z"),
      }),
    },
    wallet: {
      update: vi.fn().mockResolvedValue({ id: "wallet_player" }),
    },
  };

  return {
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaClient;
}

function tokenFor(role: UserRole): string {
  return jwt.sign({ userId: "player_1", role }, "route-test-secret");
}

describe("wallet routes", () => {
  it("rejects legacy manual deposits from non-admin users", async () => {
    vi.stubEnv("JWT_SECRET", "route-test-secret");
    const prisma = makePrisma();
    const { app } = createApp({
      prisma,
      redis: makeRedis(),
      wsService: { notifyWallet: vi.fn() } as unknown as WebSocketService,
    });

    const res = await request(app)
      .post("/api/wallet/deposit")
      .set("Authorization", `Bearer ${tokenFor(UserRole.PLAYER)}`)
      .send({ amount: "5000", referenceId: "manual-player-deposit" });

    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
