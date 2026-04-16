import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PspDepositWebhookService,
  PSP_DEPOSIT_IDEMP_KEY_PREFIX,
} from "./psp-deposit-webhook.service.js";
import type { WalletService } from "./wallet.service.js";

function basePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    pspRefId: "evt_1",
    amount: 5000,
    userId: "user_a",
    currency: "PLN",
    status: "SUCCESS" as const,
    ...overrides,
  };
}

describe("PspDepositWebhookService", () => {
  const depositFundsPspWebhook = vi.fn();
  const redisSet = vi.fn();
  const redisDel = vi.fn();
  const walletService = { depositFundsPspWebhook } as unknown as WalletService;
  const redis = {
    set: redisSet,
    del: redisDel,
  };
  const service = new PspDepositWebhookService(walletService, redis as never);

  beforeEach(() => {
    depositFundsPspWebhook.mockReset();
    redisSet.mockReset();
    redisDel.mockReset();
  });

  it("parseBody rejects unknown extra keys (strict)", () => {
    expect(() =>
      service.parseBody({
        ...basePayload(),
        extra: 1,
      }),
    ).toThrow();
  });

  it("applyDeposit ignores non-SUCCESS without Redis nor wallet", async () => {
    const r = await service.applyDeposit(
      service.parseBody({ ...basePayload(), status: "PENDING" }),
    );
    expect(r).toEqual({ outcome: "ignored_status" });
    expect(redisSet).not.toHaveBeenCalled();
    expect(depositFundsPspWebhook).not.toHaveBeenCalled();
  });

  it("applyDeposit returns redis_duplicate when SET NX does not acquire lock", async () => {
    redisSet.mockResolvedValue(null);
    const r = await service.applyDeposit(service.parseBody(basePayload()));
    expect(r).toEqual({ outcome: "redis_duplicate" });
    expect(depositFundsPspWebhook).not.toHaveBeenCalled();
    expect(redisSet).toHaveBeenCalledWith(
      `${PSP_DEPOSIT_IDEMP_KEY_PREFIX}evt_1`,
      "1",
      "EX",
      86_400,
      "NX",
    );
  });

  it("applyDeposit calls depositFundsPspWebhook with dep reference via wallet", async () => {
    redisSet.mockResolvedValue("OK");
    const txn = {
      id: "t1",
      walletId: "w1",
      amount: 5000n,
      referenceId: "dep:evt_1",
      type: "DEPOSIT" as const,
      createdAt: new Date(),
    };
    depositFundsPspWebhook.mockResolvedValue({ transaction: txn, created: true });

    const payload = service.parseBody(basePayload());
    const r = await service.applyDeposit(payload);

    expect(depositFundsPspWebhook).toHaveBeenCalledWith("user_a", 5000n, "evt_1");
    expect(r).toEqual({ outcome: "credited", transaction: txn, duplicate: false });
    expect(redisDel).not.toHaveBeenCalled();
  });

  it("applyDeposit sets duplicate when wallet returns created: false", async () => {
    redisSet.mockResolvedValue("OK");
    const txn = {
      id: "t_old",
      walletId: "w1",
      amount: 5000n,
      referenceId: "dep:evt_1",
      type: "DEPOSIT" as const,
      createdAt: new Date("2025-01-01"),
    };
    depositFundsPspWebhook.mockResolvedValue({ transaction: txn, created: false });

    const r = await service.applyDeposit(service.parseBody(basePayload()));
    expect(r).toEqual({ outcome: "credited", transaction: txn, duplicate: true });
  });

  it("applyDeposit deletes Redis key and rethrows on wallet error", async () => {
    redisSet.mockResolvedValue("OK");
    const err = new Error("db boom");
    depositFundsPspWebhook.mockRejectedValue(err);

    await expect(service.applyDeposit(service.parseBody(basePayload()))).rejects.toThrow(
      "db boom",
    );
    expect(redisDel).toHaveBeenCalledWith(`${PSP_DEPOSIT_IDEMP_KEY_PREFIX}evt_1`);
  });
});
