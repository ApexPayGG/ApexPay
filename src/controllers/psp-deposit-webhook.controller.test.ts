import { describe, expect, it, vi } from "vitest";
import { PspDepositWebhookController } from "./psp-deposit-webhook.controller.js";
import type { PspDepositWebhookService } from "../services/psp-deposit-webhook.service.js";

function createRes() {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  return { status, json };
}

describe("PspDepositWebhookController", () => {
  it("returns 200 credited false for non-SUCCESS (ignored)", async () => {
    const applyDeposit = vi.fn().mockResolvedValue({ outcome: "ignored_status" });
    const parseBody = vi.fn().mockReturnValue({
      pspRefId: "p",
      userId: "u",
      amount: 1,
      currency: "PLN",
      status: "PENDING",
    });
    const psp = { parseBody, applyDeposit } as unknown as PspDepositWebhookService;
    const c = new PspDepositWebhookController(psp);
    const res = createRes();
    await c.handle({ body: {} } as never, res as never);
    expect(applyDeposit).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ acknowledged: true, credited: false });
  });

  it("returns 200 for redis duplicate replay", async () => {
    const applyDeposit = vi.fn().mockResolvedValue({ outcome: "redis_duplicate" });
    const parseBody = vi.fn().mockReturnValue({});
    const psp = { parseBody, applyDeposit } as unknown as PspDepositWebhookService;
    const c = new PspDepositWebhookController(psp);
    const res = createRes();
    await c.handle({ body: {} } as never, res as never);
    expect(res.json).toHaveBeenCalledWith({
      acknowledged: true,
      credited: false,
      duplicate: true,
      reason: "redis_idempotent",
    });
  });

  it("returns 200 with transaction ids when credited", async () => {
    const applyDeposit = vi.fn().mockResolvedValue({
      outcome: "credited",
      duplicate: false,
      transaction: {
        id: "txn_1",
        referenceId: "dep:pay_1",
        walletId: "w1",
        amount: 100n,
        type: "DEPOSIT",
        createdAt: new Date(),
      },
    });
    const parseBody = vi.fn().mockReturnValue({});
    const psp = { parseBody, applyDeposit } as unknown as PspDepositWebhookService;
    const c = new PspDepositWebhookController(psp);
    const res = createRes();
    await c.handle({ body: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      acknowledged: true,
      credited: true,
      duplicate: false,
      transactionId: "txn_1",
      referenceId: "dep:pay_1",
    });
  });
});
