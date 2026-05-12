import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import { generateHash } from "./infra/autopay.js";
import type { WebSocketService } from "./services/websocket.service.js";

function itnBase64(status: "SUCCESS" | "PENDING" | "FAILURE"): string {
  const serviceId = "123456";
  const orderId = "dep:user_1:1710000000003";
  const remoteId = "REMOTE-PROCESSING";
  const amount = "12.34";
  const currency = "PLN";
  const hash = generateHash([serviceId, orderId, remoteId, amount, currency, status]);
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><transactions><transaction><ServiceID>${serviceId}</ServiceID><OrderID>${orderId}</OrderID><RemoteID>${remoteId}</RemoteID><Amount>${amount}</Amount><Currency>${currency}</Currency><PaymentStatus>${status}</PaymentStatus><Hash>${hash}</Hash></transaction></transactions>`,
    "utf8",
  ).toString("base64");
}

describe("POST /internal/webhooks/autopay-itn idempotency state", () => {
  it("nie potwierdza duplikatu SUCCESS gdy pierwsze przetwarzanie nadal trwa", async () => {
    process.env.AUTOPAY_SHARED_KEY = "testkey123";
    process.env.AUTOPAY_SERVICE_ID = "123456";
    process.env.AUTOPAY_GATEWAY_URL = "https://pay-accept.bm.pl";
    process.env.AUTOPAY_RETURN_URL = "https://app.example.com/payments/return";
    process.env.AUTOPAY_ITN_URL = "https://api.example.com/internal/webhooks/autopay-itn";

    const redis = {
      ping: vi.fn().mockResolvedValue("PONG"),
      set: vi.fn().mockResolvedValue(null),
      get: vi.fn().mockResolvedValue("processing"),
      del: vi.fn().mockResolvedValue(1),
    } as unknown as Redis;
    const tx = {
      transaction: { findFirst: vi.fn(), create: vi.fn() },
      wallet: { findUnique: vi.fn(), update: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const { app } = createApp({
      prisma,
      redis,
      wsService: { notifyWallet: vi.fn() } as unknown as WebSocketService,
    });

    const res = await request(app)
      .post("/internal/webhooks/autopay-itn")
      .type("form")
      .send({ transactions: itnBase64("SUCCESS") });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("<confirmation>CONFIRMED</confirmation>");
    expect(res.text).toContain("PROCESSING");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
