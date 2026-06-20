import { describe, expect, it, vi } from "vitest";
import { ConnectedAccountStatus, type PrismaClient } from "@prisma/client";
import { FraudCheckStatus } from "@prisma/client";
import {
  ConnectedAccountInactiveError,
  ConnectedAccountIntegratorMismatchError,
  ConnectedAccountNotFoundError,
  IdempotencyConflictError,
  MarketplaceValidationError,
  mergeIntegrationSplitLines,
  mergeSplitLines,
  MarketplaceChargeService,
} from "./marketplace-charge.service.js";
import { FraudBlockedError } from "./fraud-detection.service.js";
import { InsufficientFundsError } from "./wallet.service.js";

describe("mergeSplitLines", () => {
  it("łączy powtórzone connectedAccountId", () => {
    const m = mergeSplitLines([
      { connectedAccountId: "a", amountCents: 100n },
      { connectedAccountId: "a", amountCents: 50n },
      { connectedAccountId: "b", amountCents: 25n },
    ]);
    expect(m.get("a")).toBe(150n);
    expect(m.get("b")).toBe(25n);
  });

  it("rzuca przy pustym id", () => {
    expect(() =>
      mergeSplitLines([{ connectedAccountId: "  ", amountCents: 1n }]),
    ).toThrow(MarketplaceValidationError);
  });

  it("rzuca przy amountCents <= 0", () => {
    expect(() =>
      mergeSplitLines([{ connectedAccountId: "x", amountCents: 0n }]),
    ).toThrow(MarketplaceValidationError);
  });
});

describe("mergeIntegrationSplitLines", () => {
  it("zwraca pustą mapę dla pustej tablicy", () => {
    expect(mergeIntegrationSplitLines([]).size).toBe(0);
  });
});

describe("MarketplaceChargeService.createIntegrationCharge (Redis)", () => {
  it("rzuca IdempotencyConflictError gdy SET NX nie ustawi klucza", async () => {
    const redis = {
      set: vi.fn().mockResolvedValue(null),
      del: vi.fn(),
    };
    const service = new MarketplaceChargeService({} as PrismaClient);
    await expect(
      service.createIntegrationCharge({
        redis: redis as never,
        integratorUserId: "u1",
        idempotencyKey: "idem-a",
        amountCents: 100n,
        currency: "PLN",
        splits: [],
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(redis.set).toHaveBeenCalled();
  });

  it("rzuca ConnectedAccountInactiveError gdy subkonto nie jest ACTIVE", async () => {
    const redis = {
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
    };
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "ca1",
        userId: "subj1",
        status: ConnectedAccountStatus.PENDING,
        integratorUserId: "u1",
      },
    ]);
    const prisma = {
      connectedAccount: { findMany },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const service = new MarketplaceChargeService(prisma);
    await expect(
      service.createIntegrationCharge({
        redis: redis as never,
        integratorUserId: "u1",
        idempotencyKey: "idem-inactive",
        amountCents: 100n,
        currency: "PLN",
        splits: [{ connectedAccountId: "ca1", amountCents: 50n }],
      }),
    ).rejects.toBeInstanceOf(ConnectedAccountInactiveError);
    expect(redis.del).toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rzuca ConnectedAccountIntegratorMismatchError gdy subkonto należy do innego integratora", async () => {
    const redis = {
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
    };
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "ca1",
        userId: "subj1",
        status: ConnectedAccountStatus.ACTIVE,
        integratorUserId: "other-integrator",
      },
    ]);
    const prisma = {
      connectedAccount: { findMany },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const service = new MarketplaceChargeService(prisma);
    await expect(
      service.createIntegrationCharge({
        redis: redis as never,
        integratorUserId: "u1",
        idempotencyKey: "idem-mismatch",
        amountCents: 100n,
        currency: "PLN",
        splits: [{ connectedAccountId: "ca1", amountCents: 50n }],
      }),
    ).rejects.toBeInstanceOf(ConnectedAccountIntegratorMismatchError);
    expect(redis.del).toHaveBeenCalled();
  });

  it("rzuca MarketplaceValidationError gdy ACTIVE ale brak userId (KYC)", async () => {
    const redis = {
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
    };
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "ca1",
        userId: null,
        status: ConnectedAccountStatus.ACTIVE,
        integratorUserId: "u1",
      },
    ]);
    const prisma = {
      connectedAccount: { findMany },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const service = new MarketplaceChargeService(prisma);
    await expect(
      service.createIntegrationCharge({
        redis: redis as never,
        integratorUserId: "u1",
        idempotencyKey: "idem-nouser",
        amountCents: 100n,
        currency: "PLN",
        splits: [{ connectedAccountId: "ca1", amountCents: 50n }],
      }),
    ).rejects.toBeInstanceOf(MarketplaceValidationError);
  });

  it("rzuca ConnectedAccountNotFoundError gdy brak rekordu subkonta", async () => {
    const redis = {
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
    };
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      connectedAccount: { findMany },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const service = new MarketplaceChargeService(prisma);
    await expect(
      service.createIntegrationCharge({
        redis: redis as never,
        integratorUserId: "u1",
        idempotencyKey: "idem-missing",
        amountCents: 100n,
        currency: "PLN",
        splits: [{ connectedAccountId: "unknown-ca", amountCents: 50n }],
      }),
    ).rejects.toBeInstanceOf(ConnectedAccountNotFoundError);
    expect(redis.del).toHaveBeenCalled();
  });

  it("FraudBlockedError gdy FraudDetection zwraca BLOCKED (przed $transaction)", async () => {
    const redis = {
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
    };
    const fraud = {
      evaluate: vi.fn().mockResolvedValue({
        status: FraudCheckStatus.BLOCKED,
        fraudCheckId: "fc_block_1",
        score: 85,
        rulesTriggered: [],
      }),
    };
    const prisma = {
      connectedAccount: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const service = new MarketplaceChargeService(
      prisma,
      undefined,
      undefined,
      fraud as never,
    );
    await expect(
      service.createIntegrationCharge({
        redis: redis as never,
        integratorUserId: "u1",
        idempotencyKey: "idem-fraud-block",
        amountCents: 100n,
        currency: "PLN",
        splits: [],
      }),
    ).rejects.toMatchObject({
      name: "FraudBlockedError",
      fraudCheckId: "fc_block_1",
      score: 85,
    });
    expect(redis.del).toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rzuca InsufficientFundsError gdy guarded debit integratora nie zaktualizuje portfela", async () => {
    const redis = {
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
    };
    const tx = {
      paymentMethod: { findFirst: vi.fn() },
      wallet: {
        findUnique: vi.fn().mockResolvedValue({ id: "wal_integrator" }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn(),
      },
      marketplaceCharge: { create: vi.fn() },
      transaction: { create: vi.fn() },
      webhookOutbox: { create: vi.fn() },
    };
    const prisma = {
      connectedAccount: { findMany: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const service = new MarketplaceChargeService(prisma);

    await expect(
      service.createIntegrationCharge({
        redis: redis as never,
        integratorUserId: "u1",
        idempotencyKey: "idem-overdraw",
        amountCents: 100n,
        currency: "PLN",
        splits: [],
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    expect(tx.wallet.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", balance: { gte: 100n } },
      data: { balance: { decrement: 100n } },
    });
    expect(tx.marketplaceCharge.create).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalled();
  });
});

describe("MarketplaceChargeService.chargeSplit", () => {
  it("rzuca InsufficientFundsError gdy guarded debit płatnika nie zaktualizuje portfela", async () => {
    const connectedAccountFindMany = vi.fn().mockResolvedValue([
      {
        id: "ca1",
        userId: "seller1",
        status: ConnectedAccountStatus.ACTIVE,
      },
    ]);
    const tx = {
      marketplaceCharge: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      wallet: {
        findUnique: vi.fn().mockResolvedValue({ id: "payer_wallet" }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn(),
      },
      transaction: { create: vi.fn() },
    };
    const prisma = {
      marketplaceCharge: { findUnique: vi.fn().mockResolvedValue(null) },
      connectedAccount: { findMany: connectedAccountFindMany },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const service = new MarketplaceChargeService(prisma);

    await expect(
      service.chargeSplit({
        debitUserId: "payer1",
        amountCents: 100n,
        splits: [{ connectedAccountId: "ca1", amountCents: 100n }],
        idempotencyKey: "admin-overdraw",
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    expect(tx.wallet.updateMany).toHaveBeenCalledWith({
      where: { userId: "payer1", balance: { gte: 100n } },
      data: { balance: { decrement: 100n } },
    });
    expect(tx.marketplaceCharge.create).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });
});
