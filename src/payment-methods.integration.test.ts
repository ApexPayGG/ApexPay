import jwt from "jsonwebtoken";
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { Prisma, PaymentMethodProvider, type PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import type { WebSocketService } from "./services/websocket.service.js";

describe("GET/POST /api/v1/payment-methods (integration)", () => {
  const JWT_SECRET = "payment-methods-integration-secret";

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  function bearer(userId: string): string {
    return jwt.sign({ userId }, JWT_SECRET);
  }

  function buildPrisma() {
    const pm = {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({
        id: "pm_new",
        userId: "user-a",
        provider: PaymentMethodProvider.MOCK_PSP,
        token: "pm_tok",
        type: "CARD",
        last4: "4242",
        expMonth: 12,
        expYear: 2030,
        isDefault: false,
        createdAt: new Date("2026-04-01T10:00:00.000Z"),
        updatedAt: new Date("2026-04-01T10:00:00.000Z"),
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: "pm_new",
          userId: "user-a",
          provider: PaymentMethodProvider.MOCK_PSP,
          token: "pm_tok",
          type: "CARD",
          last4: "4242",
          expMonth: 12,
          expYear: 2030,
          isDefault: false,
          createdAt: new Date("2026-04-01T10:00:00.000Z"),
          updatedAt: new Date("2026-04-01T10:00:00.000Z"),
        },
      ]),
    };
    const tx = { paymentMethod: pm };
    return {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      paymentMethod: pm,
    } as unknown as PrismaClient;
  }

  it("returns 401 without token (POST)", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma: {} as PrismaClient, redis, wsService });

    const res = await request(app).post("/api/v1/payment-methods").send({
      provider: "MOCK_PSP",
      token: "pm_1",
      type: "CARD",
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when body is invalid despite valid JWT (POST)", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma: buildPrisma(), redis, wsService });

    const res = await request(app)
      .post("/api/v1/payment-methods")
      .set("Authorization", `Bearer ${bearer("user-a")}`)
      .send({ provider: "MOCK_PSP", token: "", type: "CARD" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_REQUEST");
  });

  it("returns 201 and redacted token on success (POST)", async () => {
    const prisma = buildPrisma();
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .post("/api/v1/payment-methods")
      .set("Authorization", `Bearer ${bearer("user-a")}`)
      .send({
        provider: "MOCK_PSP",
        token: "pm_secret",
        type: "CARD",
        last4: "4242",
        expMonth: 12,
        expYear: 2030,
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("success");
    expect(res.body.data.id).toBe("pm_new");
    expect(res.body.data.token).toBe("[redacted]");
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("returns 401 without token (GET)", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma: buildPrisma(), redis, wsService });

    const res = await request(app).get("/api/v1/payment-methods");
    expect(res.status).toBe(401);
  });

  it("returns 200 with list sorted path via service (GET)", async () => {
    const prisma = buildPrisma();
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .get("/api/v1/payment-methods")
      .set("Authorization", `Bearer ${bearer("user-a")}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].token).toBe("[redacted]");
    expect(prisma.paymentMethod.findMany).toHaveBeenCalled();
  });

  it("returns 409 when provider+token already exists (POST)", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["provider", "token"] },
    });
    const tx = {
      paymentMethod: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockRejectedValue(err),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      paymentMethod: tx.paymentMethod,
    } as unknown as PrismaClient;
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .post("/api/v1/payment-methods")
      .set("Authorization", `Bearer ${bearer("user-a")}`)
      .send({
        provider: "MOCK_PSP",
        token: "pm_dup",
        type: "CARD",
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });
});
