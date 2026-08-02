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

  it("rzuca IdempotencyConflictError gdy Redis SET NX nie ustawi klucza i brak wpisu w DB", async () => {
    const redis = buildRedis({ setReturnsOk: false });
    const prisma = {
      payout: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
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

  it("po wygaśnięciu Redis zwraca istniejącą wypłatę z DB bez ponownego debitu (durable idempotency)", async () => {
    const redis = buildRedis({ setReturnsOk: true });
    const existingPayout = {
      id: "payout_existing_1",
      connectedAccountId: accountId,
      amount: 100n,
      currency: "PLN",
      status: "PENDING",
      pspReferenceId: null,
      fraudCheckId: null,
      idempotencyKey: "idem-durable-1",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    };
    const findUniquePayout = vi.fn().mockResolvedValue(existingPayout);
    const walletUpdate = vi.fn();
    const prisma = {
      payout: { findUnique: findUniquePayout },
      connectedAccount: { findUnique: vi.fn() },
      wallet: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          payout: { findUnique: findUniquePayout, create: vi.fn() },
          wallet: { update: walletUpdate, findUnique: vi.fn() },
          transaction: { create: vi.fn() },
          webhookOutbox: { create: vi.fn() },
        };
        return fn(tx);
      }),
    } as unknown as PrismaClient;
    const service = new PayoutService(prisma);

    const result = await service.createPayout({
      redis: redis as never,
      integratorUserId,
      idempotencyKey: "idem-durable-1",
      connectedAccountId: accountId,
      amount: 100n,
    });

    expect(result.payout.id).toBe("payout_existing_1");
    expect(findUniquePayout).toHaveBeenCalledWith({
      where: { idempotencyKey: "idem-durable-1" },
    });
    expect(walletUpdate).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.connectedAccount.findUnique).not.toHaveBeenCalled();
  });

  it("gdy Redis NX koliduje, zwraca istniejącą wypłatę z DB zamiast 409", async () => {
    const redis = buildRedis({ setReturnsOk: false });
    const existingPayout = {
      id: "payout_existing_2",
      connectedAccountId: accountId,
      amount: 250n,
      currency: "PLN",
      status: "PENDING",
      pspReferenceId: null,
      fraudCheckId: null,
      idempotencyKey: "idem-replay-1",
      createdAt: new Date("2026-07-02T00:00:00.000Z"),
      updatedAt: new Date("2026-07-02T00:00:00.000Z"),
    };
    const prisma = {
      payout: { findUnique: vi.fn().mockResolvedValue(existingPayout) },
    } as unknown as PrismaClient;
    const service = new PayoutService(prisma);

    const result = await service.createPayout({
      redis: redis as never,
      integratorUserId,
      idempotencyKey: "idem-replay-1",
      connectedAccountId: accountId,
      amount: 250n,
    });

    expect(result.payout.id).toBe("payout_existing_2");
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
      payout: { findUnique: vi.fn().mockResolvedValue(null) },
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
      payout: { findUnique: vi.fn().mockResolvedValue(null) },
      connectedAccount: { findUnique: findUniqueAccount },
      wallet: { findUnique: findUniqueWallet },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          wallet: { update: vi.fn().mockResolvedValue({}) },
          transaction: { create: vi.fn().mockResolvedValue({}) },
          payout: {
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({
              id: payoutId,
              connectedAccountId: accountId,
              amount: 100n,
              currency: "PLN",
              idempotencyKey: "idem-outbox-queue",
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
