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
});
