import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import { generateHash } from "./infra/autopay.js";
import type { WebSocketService } from "./services/websocket.service.js";

function buildItnBase64(params: {
  serviceId: string;
  orderId: string;
  remoteId: string;
  amount: string;
  currency: string;
  status: "SUCCESS" | "PENDING" | "FAILURE";
  customerHash?: string;
}): string {
  const hash = generateHash([
    params.serviceId,
    params.orderId,
    params.remoteId,
    params.amount,
    params.currency,
    params.status,
  ]);
  const customerHashTag =
    params.customerHash !== undefined
      ? `<CustomerHash>${params.customerHash}</CustomerHash>`
      : "";
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<transactions>
  <transaction>
    <ServiceID>${params.serviceId}</ServiceID>
    <OrderID>${params.orderId}</OrderID>
    <RemoteID>${params.remoteId}</RemoteID>
    <Amount>${params.amount}</Amount>
    <Currency>${params.currency}</Currency>
    <PaymentStatus>${params.status}</PaymentStatus>
    <Hash>${hash}</Hash>
    ${customerHashTag}
  </transaction>
</transactions>`;
  return Buffer.from(xml, "utf8").toString("base64");
}

describe("POST /internal/webhooks/autopay-itn", () => {
  it("SUCCESS księguje środki i działa idempotentnie po OrderID+RemoteID", async () => {
    process.env.AUTOPAY_SHARED_KEY = "testkey123";
    process.env.AUTOPAY_SERVICE_ID = "123456";
    process.env.AUTOPAY_GATEWAY_URL = "https://pay-accept.bm.pl";
    process.env.AUTOPAY_RETURN_URL = "https://app.example.com/payments/return";
    process.env.AUTOPAY_ITN_URL = "https://api.example.com/internal/webhooks/autopay-itn";

    let idempTaken = false;
    const redis = {
      ping: vi.fn().mockResolvedValue("PONG"),
      set: vi.fn().mockImplementation(async () => {
        if (idempTaken) {
          return null;
        }
        idempTaken = true;
        return "OK";
      }),
      del: vi.fn().mockResolvedValue(1),
    } as unknown as Redis;

    const tx = {
      transaction: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: "txn_1",
          walletId: "w1",
          amount: 3550n,
          referenceId: "dep:REMOTE-1",
          type: "DEPOSIT",
          createdAt: new Date(),
        }),
      },
      wallet: {
        findUnique: vi.fn().mockResolvedValue({ id: "w1" }),
        update: vi.fn().mockResolvedValue({}),
      },
      paymentMethod: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({
          id: "pm1",
          userId: "user_1",
          provider: "AUTOPAY",
          token: "cust_h_1",
          type: "AUTOPAY_RECURRING",
          last4: null,
          expMonth: null,
          expYear: null,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    };

    const prisma = {
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;

    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma, redis, wsService });

    const orderId = "dep:user_1:1710000000000";
    const payload = buildItnBase64({
      serviceId: "123456",
      orderId,
      remoteId: "REMOTE-1",
      amount: "35.50",
      currency: "PLN",
      status: "SUCCESS",
      customerHash: "cust_h_1",
    });

    const res1 = await request(app)
      .post("/internal/webhooks/autopay-itn")
      .type("form")
      .send({ transactions: payload });
    expect(res1.status).toBe(200);
    expect(res1.text).toContain("<confirmation>CONFIRMED</confirmation>");
    expect(tx.transaction.create).toHaveBeenCalledTimes(1);

    const res2 = await request(app)
      .post("/internal/webhooks/autopay-itn")
      .type("form")
      .send({ transactions: payload });
    expect(res2.status).toBe(200);
    expect(res2.text).toContain("<confirmation>CONFIRMED</confirmation>");
    expect(tx.transaction.create).toHaveBeenCalledTimes(1);
  });
});
