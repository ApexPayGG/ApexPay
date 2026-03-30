import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PspDepositWebhookService,
  PSP_DEPOSIT_REFERENCE_PREFIX,
} from "./psp-deposit-webhook.service.js";
import type { WalletService } from "./wallet.service.js";

describe("PspDepositWebhookService", () => {
  const depositFunds = vi.fn();
  const walletService = { depositFunds } as unknown as WalletService;
  const service = new PspDepositWebhookService(walletService);

  beforeEach(() => {
    depositFunds.mockReset();
  });

  it("parseBody rejects unknown extra keys (strict)", () => {
    expect(() =>
      service.parseBody({
        paymentId: "p1",
        userId: "u1",
        amountMinor: "100",
        status: "succeeded",
        extra: 1,
      }),
    ).toThrow();
  });

  it("applyDeposit ignores non-succeeded without calling wallet", async () => {
    const r = await service.applyDeposit(
      service.parseBody({
        paymentId: "p1",
        userId: "u1",
        amountMinor: "100",
        status: "pending",
      }),
    );
    expect(r).toEqual({ outcome: "ignored_status" });
    expect(depositFunds).not.toHaveBeenCalled();
  });

  it("applyDeposit calls depositFunds with prefixed referenceId", async () => {
    const txn = {
      id: "t1",
      walletId: "w1",
      amount: 500n,
      referenceId: `${PSP_DEPOSIT_REFERENCE_PREFIX}pay_xyz`,
      type: "DEPOSIT" as const,
      createdAt: new Date(),
    };
    depositFunds.mockResolvedValue({ transaction: txn, created: true });

    const payload = service.parseBody({
      paymentId: "pay_xyz",
      userId: "user_a",
      amountMinor: "500",
      status: "succeeded",
    });
    const r = await service.applyDeposit(payload);

    expect(depositFunds).toHaveBeenCalledWith("user_a", 500n, `${PSP_DEPOSIT_REFERENCE_PREFIX}pay_xyz`);
    expect(r).toEqual({ outcome: "credited", transaction: txn, duplicate: false });
  });

  it("applyDeposit sets duplicate when depositFunds returns created: false", async () => {
    const txn = {
      id: "t_old",
      walletId: "w1",
      amount: 500n,
      referenceId: `${PSP_DEPOSIT_REFERENCE_PREFIX}pay_dup`,
      type: "DEPOSIT" as const,
      createdAt: new Date("2025-01-01"),
    };
    depositFunds.mockResolvedValue({ transaction: txn, created: false });

    const r = await service.applyDeposit(
      service.parseBody({
        paymentId: "pay_dup",
        userId: "user_a",
        amountMinor: "500",
        status: "succeeded",
      }),
    );

    expect(r).toEqual({ outcome: "credited", transaction: txn, duplicate: true });
  });
});
