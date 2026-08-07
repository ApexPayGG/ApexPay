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
  it("rzuca IdempotencyConflictError gdy SET NX nie ustawi klucza i brak wpisu w DB", async () => {
    const redis = {
      set: vi.fn().mockResolvedValue(null),
      del: vi.fn(),
    };
    const prisma = {
      marketplaceCharge: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const service = new MarketplaceChargeService(prisma);
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
    expect(prisma.marketplaceCharge.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: "idem-a" },
    });
  });

  it("po Redis NX miss zwraca trwały charge gdy integrator/kwota/waluta się zgadzają", async () => {
    const redis = {
      set: vi.fn().mockResolvedValue(null),
      del: vi.fn(),
    };
    const existing = {
      id: "ch_durable_1",
      debitUserId: "u1",
      integratorUserId: "u1",
      amountCents: 100n,
      currency: "PLN",
      idempotencyKey: "idem-durable-1",
    };
    const prisma = {
      marketplaceCharge: { findUnique: vi.fn().mockResolvedValue(existing) },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const service = new MarketplaceChargeService(prisma);
    const out = await service.createIntegrationCharge({
      redis: redis as never,
      integratorUserId: "u1",
      idempotencyKey: "idem-durable-1",
      amountCents: 100n,
      currency: "PLN",
      splits: [],
    });
    expect(out.charge).toEqual(existing);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it("po Redis NX miss rzuca konflikt gdy kwota nie pasuje do trwałego charge", async () => {
    const redis = {
      set: vi.fn().mockResolvedValue(null),
      del: vi.fn(),
    };
    const existing = {
      id: "ch_mismatch_1",
      debitUserId: "u1",
      integratorUserId: "u1",
      amountCents: 100n,
      currency: "PLN",
      idempotencyKey: "idem-mismatch-amt",
    };
    const prisma = {
      marketplaceCharge: { findUnique: vi.fn().mockResolvedValue(existing) },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const service = new MarketplaceChargeService(prisma);
    await expect(
      service.createIntegrationCharge({
        redis: redis as never,
        integratorUserId: "u1",
        idempotencyKey: "idem-mismatch-amt",
        amountCents: 99999n,
        currency: "PLN",
        splits: [],
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
      marketplaceCharge: { findUnique: vi.fn().mockResolvedValue(null) },
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
      marketplaceCharge: { findUnique: vi.fn().mockResolvedValue(null) },
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
      marketplaceCharge: { findUnique: vi.fn().mockResolvedValue(null) },
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
      marketplaceCharge: { findUnique: vi.fn().mockResolvedValue(null) },
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
      marketplaceCharge: { findUnique: vi.fn().mockResolvedValue(null) },
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
});

describe("MarketplaceChargeService.chargeSplit (idempotency params)", () => {
  it("zwraca idempotent:true gdy klucz, płatnik i kwota się zgadzają", async () => {
    const existing = {
      id: "ch_split_1",
      debitUserId: "payer_a",
      integratorUserId: "payer_a",
      amountCents: 500n,
      currency: "PLN",
    };
    const prisma = {
      marketplaceCharge: { findUnique: vi.fn().mockResolvedValue(existing) },
      connectedAccount: { findMany: vi.fn() },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const service = new MarketplaceChargeService(prisma);
    const out = await service.chargeSplit({
      debitUserId: "payer_a",
      amountCents: 500n,
      splits: [{ connectedAccountId: "ca1", amountCents: 500n }],
      idempotencyKey: "idem-split-ok",
    });
    expect(out).toEqual({ chargeId: "ch_split_1", idempotent: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.connectedAccount.findMany).not.toHaveBeenCalled();
  });

  it("rzuca IdempotencyConflictError gdy ten sam klucz ma inną kwotę", async () => {
    const existing = {
      id: "ch_split_2",
      debitUserId: "payer_a",
      integratorUserId: "payer_a",
      amountCents: 100n,
      currency: "PLN",
    };
    const prisma = {
      marketplaceCharge: { findUnique: vi.fn().mockResolvedValue(existing) },
      connectedAccount: { findMany: vi.fn() },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const service = new MarketplaceChargeService(prisma);
    await expect(
      service.chargeSplit({
        debitUserId: "payer_a",
        amountCents: 50000n,
        splits: [{ connectedAccountId: "ca1", amountCents: 50000n }],
        idempotencyKey: "idem-split-amt",
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rzuca IdempotencyConflictError gdy ten sam klucz ma innego płatnika", async () => {
    const existing = {
      id: "ch_split_3",
      debitUserId: "payer_a",
      integratorUserId: "payer_a",
      amountCents: 500n,
      currency: "PLN",
    };
    const prisma = {
      marketplaceCharge: { findUnique: vi.fn().mockResolvedValue(existing) },
      connectedAccount: { findMany: vi.fn() },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const service = new MarketplaceChargeService(prisma);
    await expect(
      service.chargeSplit({
        debitUserId: "payer_b",
        amountCents: 500n,
        splits: [{ connectedAccountId: "ca1", amountCents: 500n }],
        idempotencyKey: "idem-split-payer",
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
