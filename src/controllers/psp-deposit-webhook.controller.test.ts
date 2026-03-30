import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  PspDepositWebhookController,
  PSP_DEPOSIT_SIGNATURE_HEADER,
} from "./psp-deposit-webhook.controller.js";
import type { PspDepositWebhookService } from "../services/psp-deposit-webhook.service.js";

function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function createRes() {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  return { status, json };
}

describe("PspDepositWebhookController", () => {
  const secret = "whsec_unit_test";
  const getSecret = () => secret;

  it("returns 503 when secret is missing", async () => {
    const psp = {} as PspDepositWebhookService;
    const c = new PspDepositWebhookController(psp, () => undefined);
    const res = createRes();
    await c.handle({ rawBody: Buffer.from("{}"), body: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it("returns 400 when rawBody is missing", async () => {
    const psp = {} as PspDepositWebhookService;
    const c = new PspDepositWebhookController(psp, getSecret);
    const res = createRes();
    await c.handle({ body: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 401 when signature is invalid", async () => {
    const psp = {} as PspDepositWebhookService;
    const c = new PspDepositWebhookController(psp, getSecret);
    const bodyStr = '{"paymentId":"p","userId":"u","amountMinor":"1","status":"succeeded"}';
    const res = createRes();
    const req = {
      rawBody: Buffer.from(bodyStr, "utf8"),
      body: JSON.parse(bodyStr),
      get: (h: string) => (h === PSP_DEPOSIT_SIGNATURE_HEADER ? "00".repeat(32) : undefined),
    };
    await c.handle(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 200 credited false for non-succeeded status", async () => {
    const applyDeposit = vi.fn().mockResolvedValue({ outcome: "ignored_status" });
    const parseBody = vi.fn().mockReturnValue({
      paymentId: "p",
      userId: "u",
      amountMinor: "1",
      status: "pending",
    });
    const psp = { parseBody, applyDeposit } as unknown as PspDepositWebhookService;
    const c = new PspDepositWebhookController(psp, getSecret);
    const bodyStr = '{"paymentId":"p","userId":"u","amountMinor":"1","status":"pending"}';
    const res = createRes();
    const req = {
      rawBody: Buffer.from(bodyStr, "utf8"),
      body: JSON.parse(bodyStr),
      get: (h: string) => (h === PSP_DEPOSIT_SIGNATURE_HEADER ? signBody(bodyStr, secret) : undefined),
    };
    await c.handle(req as never, res as never);
    expect(applyDeposit).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ acknowledged: true, credited: false });
  });

  it("returns 200 with transaction ids when credited", async () => {
    const applyDeposit = vi.fn().mockResolvedValue({
      outcome: "credited",
      duplicate: false,
      transaction: {
        id: "txn_1",
        referenceId: "psp_deposit:pay_1",
        walletId: "w1",
        amount: 100n,
        type: "DEPOSIT",
        createdAt: new Date(),
      },
    });
    const parseBody = vi.fn().mockReturnValue({
      paymentId: "pay_1",
      userId: "u1",
      amountMinor: "100",
      status: "succeeded",
    });
    const psp = { parseBody, applyDeposit } as unknown as PspDepositWebhookService;
    const c = new PspDepositWebhookController(psp, getSecret);
    const bodyStr =
      '{"paymentId":"pay_1","userId":"u1","amountMinor":"100","status":"succeeded"}';
    const res = createRes();
    const req = {
      rawBody: Buffer.from(bodyStr, "utf8"),
      body: JSON.parse(bodyStr),
      get: (h: string) => (h === PSP_DEPOSIT_SIGNATURE_HEADER ? signBody(bodyStr, secret) : undefined),
    };
    await c.handle(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      acknowledged: true,
      credited: true,
      duplicate: false,
      transactionId: "txn_1",
      referenceId: "psp_deposit:pay_1",
    });
  });
});
