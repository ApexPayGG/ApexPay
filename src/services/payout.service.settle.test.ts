import { describe, it, expect, vi, beforeEach } from "vitest";
import { PayoutStatus, TransactionType, type PrismaClient } from "@prisma/client";
import {
  PayoutInvalidStateError,
  PayoutNotFoundError,
  PayoutService,
} from "./payout.service.js";

describe("PayoutService.settlePayout", () => {
  let walletBalance: bigint;

  beforeEach(() => {
    walletBalance = 900n;
  });

  it("FAILED — przywraca saldo portfela (zwrot = kwota wypłaty)", async () => {
    const payoutRow = {
      id: "payout_uuid_1",
      amount: 100n,
      currency: "PLN",
      status: PayoutStatus.PENDING,
      connectedAccountId: "ca1",
      connectedAccount: { integratorUserId: "int1", userId: "user_subj" },
    };

    const settledRow = {
      id: payoutRow.id,
      connectedAccountId: payoutRow.connectedAccountId,
      amount: payoutRow.amount,
      currency: payoutRow.currency,
      status: PayoutStatus.FAILED,
      pspReferenceId: null,
      createdAt: new Date("2026-04-13T10:00:00.000Z"),
      updatedAt: new Date("2026-04-13T11:00:00.000Z"),
    };

    const tx = {
      payout: {
        findUnique: vi.fn().mockResolvedValue(payoutRow),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(settledRow),
      },
      wallet: {
        findUnique: vi.fn().mockResolvedValue({ id: "w1" }),
        update: vi.fn().mockImplementation(async () => {
          walletBalance += 100n;
        }),
      },
      transaction: {
        create: vi.fn().mockResolvedValue({}),
      },
      webhookOutbox: {
        create: vi.fn().mockResolvedValue({ id: "wo_settle_failed_1" }),
      },
    };

    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;

    const webhookPublish = vi.fn().mockResolvedValue(undefined);
    const service = new PayoutService(prisma, webhookPublish);
    const out = await service.settlePayout("payout_uuid_1", "FAILED");

    expect(walletBalance).toBe(1000n);
    expect(tx.transaction.create).toHaveBeenCalledWith({
      data: {
        walletId: "w1",
        amount: 100n,
        referenceId: "pout-void:payout_uuid_1",
        type: TransactionType.PAYOUT_REVERSAL,
      },
    });
    expect(tx.webhookOutbox.create).toHaveBeenCalledWith({
      data: {
        integratorUserId: "int1",
        eventType: "payout.failed",
        payload: {
          id: "payout_uuid_1",
          amount: "100",
          currency: "PLN",
          connectedAccountId: "ca1",
          status: "FAILED",
        },
      },
    });
    expect(out.status).toBe(PayoutStatus.FAILED);
    expect(webhookPublish).toHaveBeenCalledWith("wo_settle_failed_1");
  });

  it("rzuca PayoutNotFoundError gdy brak rekordu", async () => {
    const tx = {
      payout: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;

    const service = new PayoutService(prisma);
    await expect(service.settlePayout("missing", "PAID")).rejects.toBeInstanceOf(
      PayoutNotFoundError,
    );
  });

  it("rzuca PayoutInvalidStateError gdy wypłata już PAID", async () => {
    const payoutRow = {
      id: "p2",
      amount: 50n,
      currency: "PLN",
      status: PayoutStatus.PAID,
      connectedAccountId: "ca1",
      connectedAccount: { integratorUserId: "int1", userId: "u1" },
    };
    const tx = {
      payout: {
        findUnique: vi.fn().mockResolvedValue(payoutRow),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;

    const service = new PayoutService(prisma);
    await expect(service.settlePayout("p2", "FAILED")).rejects.toBeInstanceOf(
      PayoutInvalidStateError,
    );
  });

  it("PAID — outbox payout.paid", async () => {
    const payoutRow = {
      id: "p3",
      amount: 25n,
      currency: "PLN",
      status: PayoutStatus.PENDING,
      connectedAccountId: "ca2",
      connectedAccount: { integratorUserId: "int2", userId: "u2" },
    };
    const settledRow = {
      ...payoutRow,
      status: PayoutStatus.PAID,
      pspReferenceId: "psp_abc",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const tx = {
      payout: {
        findUnique: vi.fn().mockResolvedValue(payoutRow),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(settledRow),
      },
      webhookOutbox: {
        create: vi.fn().mockResolvedValue({ id: "wo_settle_paid_1" }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;

    const webhookPublish = vi.fn().mockResolvedValue(undefined);
    const service = new PayoutService(prisma, webhookPublish);
    await service.settlePayout("p3", "PAID", "psp_abc");

    expect(tx.webhookOutbox.create).toHaveBeenCalledWith({
      data: {
        integratorUserId: "int2",
        eventType: "payout.paid",
        payload: {
          id: "p3",
          amount: "25",
          currency: "PLN",
          connectedAccountId: "ca2",
          status: "PAID",
          pspReferenceId: "psp_abc",
        },
      },
    });
    expect(webhookPublish).toHaveBeenCalledWith("wo_settle_paid_1");
  });
});
