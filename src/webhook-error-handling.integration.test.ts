import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import type { WebSocketService } from "./services/websocket.service.js";

const WEBHOOK_SECRET = "whsec_error_handling_test";

function sign(body: string): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(body, "utf8").digest("hex");
}

function createTestApp(prisma: PrismaClient, redis: Redis) {
  const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
  return createApp({ prisma, redis, wsService }).app;
}

async function postSigned(app: ReturnType<typeof createTestApp>, path: string, body: object) {
  const rawBody = JSON.stringify(body);
  return request(app)
    .post(path)
    .set("content-type", "application/json")
    .set("x-apexpay-signature", sign(rawBody))
    .send(rawBody)
    .timeout({ response: 500 });
}

describe("PSP webhook infrastructure failures", () => {
  it("forwards deposit processing failures to the global error handler", async () => {
    process.env.PSP_DEPOSIT_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const prisma = {} as PrismaClient;
    const redis = {
      set: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
    } as unknown as Redis;
    const app = createTestApp(prisma, redis);

    const response = await postSigned(app, "/internal/webhooks/psp-deposit", {
      pspRefId: "deposit-1",
      userId: "user-1",
      amount: 100,
      currency: "PLN",
      status: "SUCCESS",
    });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ code: "INTERNAL" });
  });

  it("forwards dispute processing failures to the global error handler", async () => {
    process.env.PSP_DEPOSIT_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const prisma = {
      dispute: {
        findUnique: vi.fn().mockRejectedValue(new Error("PostgreSQL unavailable")),
      },
    } as unknown as PrismaClient;
    const redis = {} as Redis;
    const app = createTestApp(prisma, redis);

    const response = await postSigned(app, "/internal/webhooks/psp-dispute", {
      pspDisputeId: "dispute-1",
      chargeId: "charge-1",
      reason: "FRAUDULENT",
      amount: 100,
      currency: "PLN",
      evidenceDueBy: "2026-07-22T00:00:00.000Z",
    });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ code: "INTERNAL" });
  });
});
