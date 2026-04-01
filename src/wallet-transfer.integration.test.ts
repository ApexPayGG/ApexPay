import jwt from "jsonwebtoken";
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import type { WebSocketService } from "./services/websocket.service.js";

describe("POST /api/v1/wallet/transfer (integration)", () => {
  const JWT_SECRET = "wallet-transfer-integration-secret";

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  function bearer(userId: string): string {
    return jwt.sign({ userId }, JWT_SECRET);
  }

  function buildPrismaForSuccessfulTransfer() {
    const tx = {
      transaction: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "tx" }),
      },
      wallet: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: "wal-from" })
          .mockResolvedValueOnce({ id: "wal-to" }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    return {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
  }

  it("returns 401 without token", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({
      prisma: {} as PrismaClient,
      redis,
      wsService,
    });

    const res = await request(app)
      .post("/api/v1/wallet/transfer")
      .send({ toUserId: "b", amount: "1", referenceId: "r1" });

    expect(res.status).toBe(401);
  });

  it("returns 400 when body is invalid despite valid JWT", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({
      prisma: buildPrismaForSuccessfulTransfer(),
      redis,
      wsService,
    });

    const res = await request(app)
      .post("/api/v1/wallet/transfer")
      .set("Authorization", `Bearer ${bearer("sender-1")}`)
      .send({ toUserId: "b", amount: "1" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_REQUEST");
  });

  it("returns 200 and success message when transfer completes", async () => {
    const prisma = buildPrismaForSuccessfulTransfer();
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .post("/api/v1/wallet/transfer")
      .set("Authorization", `Bearer ${bearer("sender-1")}`)
      .send({ toUserId: "recipient-2", amount: "25", referenceId: "integ-pay-1" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      idempotent: false,
      message: "Przelew wykonany pomyślnie.",
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
