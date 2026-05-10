import jwt from "jsonwebtoken";
import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import type { WebSocketService } from "./services/websocket.service.js";

describe("POST /api/wallet/deposit (integration)", () => {
  const JWT_SECRET = "wallet-deposit-integration-secret";

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  function bearer(userId: string, role = "PLAYER"): string {
    return jwt.sign({ userId, role }, JWT_SECRET);
  }

  it("rejects non-admin callers before wallet funds can be minted", async () => {
    const tx = {
      transaction: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: "tx-dep",
          walletId: "wallet-player",
          amount: 999999n,
          referenceId: "client-minted-ref",
          type: "DEPOSIT",
          createdAt: new Date("2026-05-10T11:00:00.000Z"),
        }),
      },
      wallet: {
        update: vi.fn().mockResolvedValue({ id: "wallet-player" }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .post("/api/wallet/deposit")
      .set("Authorization", `Bearer ${bearer("player-1")}`)
      .send({ amount: "999999", referenceId: "client-minted-ref" });

    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
