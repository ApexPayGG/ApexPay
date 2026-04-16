import { describe, expect, it, vi } from "vitest";
import { ConnectedAccountStatus, type PrismaClient } from "@prisma/client";
import {
  IdempotencyConflictError,
  MarketplaceValidationError,
} from "./marketplace-charge.service.js";
import { PayoutService, PAYOUT_IDEMP_REDIS_PREFIX } from "./payout.service.js";
import { InsufficientFundsError } from "./wallet.service.js";

describe("PayoutService.createPayout", () => {
  const integratorUserId = "int_1";
  const accountId = "ca_1";
  const subjectUserId = "user_subj";

  function buildRedis(overrides?: { setReturnsOk?: boolean }) {
    const setReturnsOk = overrides?.setReturnsOk !== false;
    return {
      set: vi.fn().mockResolvedValue(setReturnsOk ? "OK" : null),
      del: vi.fn().mockResolvedValue(1),
    };
  }

  it("rzuca IdempotencyConflictError gdy Redis SET NX nie ustawi klucza", async () => {
    const redis = buildRedis({ setReturnsOk: false });
    const prisma = {} as PrismaClient;
    const service = new PayoutService(prisma);
    await expect(
      service.createPayout({
        redis: redis as never,
        integratorUserId,
        idempotencyKey: "idem-po-1",
        connectedAccountId: accountId,
        amount: 100n,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(redis.set).toHaveBeenCalledWith(
      `${PAYOUT_IDEMP_REDIS_PREFIX}idem-po-1`,
      "1",
      "EX",
      86_400,
      "NX",
    );
  });

  it("rzuca InsufficientFundsError gdy saldo portfela < amount", async () => {
    const redis = buildRedis();
    const findUniqueAccount = vi.fn().mockResolvedValue({
      id: accountId,
      integratorUserId,
      status: ConnectedAccountStatus.ACTIVE,
      userId: subjectUserId,
    });
    const findUniqueWallet = vi.fn().mockResolvedValue({
      id: "w1",
      balance: 50n,
    });
    const prisma = {
      connectedAccount: { findUnique: findUniqueAccount },
      wallet: { findUnique: findUniqueWallet },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const service = new PayoutService(prisma);

    await expect(
      service.createPayout({
        redis: redis as never,
        integratorUserId,
        idempotencyKey: "idem-po-2",
        connectedAccountId: accountId,
        amount: 100n,
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    expect(redis.del).toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rzuca MarketplaceValidationError gdy Idempotency-Key pusty (serwis)", async () => {
    const service = new PayoutService({} as PrismaClient);
    await expect(
      service.createPayout({
        redis: buildRedis() as never,
        integratorUserId,
        idempotencyKey: "   ",
        connectedAccountId: accountId,
        amount: 1n,
      }),
    ).rejects.toBeInstanceOf(MarketplaceValidationError);
  });

  it("po udanym createPayout wywołuje webhookPublish z id rekordu WebhookOutbox (jak publikacja do kolejki)", async () => {
    const outboxId = "wo_after_payout_create";
    const redis = buildRedis();
    const webhookPublish = vi.fn().mockResolvedValue(undefined);
    const payoutId = "payout_new_1";

    const findUniqueAccount = vi.fn().mockResolvedValue({
      id: accountId,
      integratorUserId,
      status: ConnectedAccountStatus.ACTIVE,
      userId: subjectUserId,
    });
    const findUniqueWallet = vi.fn().mockResolvedValue({
      id: "w1",
      balance: 500n,
    });

    const prisma = {
      connectedAccount: { findUnique: findUniqueAccount },
      wallet: { findUnique: findUniqueWallet },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          wallet: { update: vi.fn().mockResolvedValue({}) },
          transaction: { create: vi.fn().mockResolvedValue({}) },
          payout: {
            create: vi.fn().mockResolvedValue({
              id: payoutId,
              connectedAccountId: accountId,
              amount: 100n,
              currency: "PLN",
            }),
          },
          webhookOutbox: {
            create: vi.fn().mockResolvedValue({ id: outboxId }),
          },
        };
        return fn(tx);
      }),
    } as unknown as PrismaClient;

    const service = new PayoutService(prisma, webhookPublish);
    await service.createPayout({
      redis: redis as never,
      integratorUserId,
      idempotencyKey: "idem-outbox-queue",
      connectedAccountId: accountId,
      amount: 100n,
    });

    expect(webhookPublish).toHaveBeenCalledTimes(1);
    expect(webhookPublish).toHaveBeenCalledWith(outboxId);
  });
});
