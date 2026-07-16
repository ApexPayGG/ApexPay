import { ConnectedAccountStatus, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { MarketplaceChargeService } from "./marketplace-charge.service.js";
import { InsufficientFundsError } from "./wallet.service.js";

function activeConnectedAccount() {
  return {
    id: "account-1",
    userId: "recipient-1",
    status: ConnectedAccountStatus.ACTIVE,
    integratorUserId: "integrator-1",
  };
}

describe("MarketplaceChargeService payer balance", () => {
  it("rejects an integration charge when the payer debit guard matches no wallet", async () => {
    const redis = {
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
    };
    const tx = {
      wallet: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: "payer-wallet" })
          .mockResolvedValueOnce({ id: "recipient-wallet" }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      marketplaceCharge: {
        create: vi.fn().mockResolvedValue({
          id: "charge-1",
          debitUserId: "integrator-1",
          integratorUserId: "integrator-1",
          amountCents: 100n,
          currency: "PLN",
          idempotencyKey: "idem-1",
          fraudCheckId: null,
          createdAt: new Date(),
        }),
      },
      transaction: { create: vi.fn().mockResolvedValue({}) },
      webhookOutbox: { create: vi.fn().mockResolvedValue({ id: "outbox-1" }) },
    };
    const prisma = {
      connectedAccount: {
        findMany: vi.fn().mockResolvedValue([activeConnectedAccount()]),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaClient;

    const service = new MarketplaceChargeService(prisma);

    await expect(
      service.createIntegrationCharge({
        redis: redis as never,
        integratorUserId: "integrator-1",
        idempotencyKey: "idem-1",
        amountCents: 100n,
        currency: "PLN",
        splits: [{ connectedAccountId: "account-1", amountCents: 100n }],
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(tx.wallet.updateMany).toHaveBeenCalledWith({
      where: { userId: "integrator-1", balance: { gte: 100n } },
      data: { balance: { decrement: 100n } },
    });
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalled();
  });

  it("rejects an admin split charge when the payer debit guard matches no wallet", async () => {
    const tx = {
      wallet: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: "payer-wallet" })
          .mockResolvedValueOnce({ id: "recipient-wallet" }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      marketplaceCharge: {
        create: vi.fn().mockResolvedValue({ id: "charge-1" }),
        findUnique: vi.fn(),
      },
      transaction: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      connectedAccount: {
        findMany: vi.fn().mockResolvedValue([activeConnectedAccount()]),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaClient;

    const service = new MarketplaceChargeService(prisma);

    await expect(
      service.chargeSplit({
        debitUserId: "integrator-1",
        amountCents: 100n,
        splits: [{ connectedAccountId: "account-1", amountCents: 100n }],
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(tx.wallet.updateMany).toHaveBeenCalledWith({
      where: { userId: "integrator-1", balance: { gte: 100n } },
      data: { balance: { decrement: 100n } },
    });
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });
});
