import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { RefundCoveredBy, type MarketplaceCharge, type PrismaClient } from "@prisma/client";
import {
  allocateRefundCostConnectedOnly,
  allocateRefundCostSplit,
  getMarketplacePlatformUserId,
  REFUND_WINDOW_DAYS,
  RefundAmountExceededError,
  RefundService,
  RefundWindowExpiredError,
  ChargeAlreadyFullyRefundedError,
  validateRefundEligibility,
} from "./refund.service.js";
import { IdempotencyConflictError } from "./marketplace-charge.service.js";

describe("allocateRefundCostSplit", () => {
  it("dzieli koszt proporcjonalnie do P i subkont (suma = kwota zwrotu)", () => {
    const ca = new Map([
      ["ca1", 50n],
      ["ca2", 40n],
    ]);
    const { platformDebit, perConnectedAccount } = allocateRefundCostSplit(
      100n,
      100n,
      10n,
      ca,
    );
    expect(platformDebit).toBe(10n);
    expect(perConnectedAccount.get("ca1")).toBe(50n);
    expect(perConnectedAccount.get("ca2")).toBe(40n);
  });
});

describe("allocateRefundCostConnectedOnly", () => {
  it("rozdziela zwrot tylko między subkonta", () => {
    const m = allocateRefundCostConnectedOnly(
      100n,
      new Map([
        ["a", 60n],
        ["b", 40n],
      ]),
    );
    expect(m.get("a")).toBe(60n);
    expect(m.get("b")).toBe(40n);
  });
});

describe("validateRefundEligibility", () => {
  const baseCharge: MarketplaceCharge = {
    id: "ch1",
    debitUserId: "int1",
    integratorUserId: "int1",
    amountCents: 1000n,
    currency: "PLN",
    idempotencyKey: "ik",
    createdAt: new Date(),
  };

  const prisma = {
    refund: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
    },
    connectedAccount: {
      findUnique: vi.fn().mockResolvedValue({ id: "ca1" }),
    },
  } as unknown as PrismaClient;

  beforeEach(() => {
    vi.mocked(prisma.refund.aggregate).mockResolvedValue({ _sum: { amount: null } });
    vi.mocked(prisma.connectedAccount.findUnique).mockResolvedValue({ id: "ca1" });
  });

  it("rzuca RefundWindowExpiredError po 181 dniach", async () => {
    const old = new Date(Date.now() - (REFUND_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
    await expect(
      validateRefundEligibility(prisma, {
        charge: { ...baseCharge, createdAt: old },
        integratorUserId: "int1",
        refundAmount: 100n,
        coveredBy: RefundCoveredBy.PLATFORM,
        composition: { platformCents: 1000n, connectedCredits: new Map() },
      }),
    ).rejects.toBeInstanceOf(RefundWindowExpiredError);
  });

  it("rzuca RefundAmountExceededError gdy suma zwrotów przekroczy charge", async () => {
    vi.mocked(prisma.refund.aggregate).mockResolvedValue({ _sum: { amount: 900n } });
    await expect(
      validateRefundEligibility(prisma, {
        charge: baseCharge,
        integratorUserId: "int1",
        refundAmount: 200n,
        coveredBy: RefundCoveredBy.PLATFORM,
        composition: { platformCents: 500n, connectedCredits: new Map([["ca1", 500n]]) },
      }),
    ).rejects.toBeInstanceOf(RefundAmountExceededError);
  });

  it("rzuca ChargeAlreadyFullyRefundedError gdy już zwrócono 100%", async () => {
    vi.mocked(prisma.refund.aggregate).mockResolvedValue({ _sum: { amount: 1000n } });
    await expect(
      validateRefundEligibility(prisma, {
        charge: baseCharge,
        integratorUserId: "int1",
        refundAmount: 1n,
        coveredBy: RefundCoveredBy.PLATFORM,
        composition: { platformCents: 1000n, connectedCredits: new Map() },
      }),
    ).rejects.toBeInstanceOf(ChargeAlreadyFullyRefundedError);
  });

  it("pozwala na dwa częściowe zwroty w granicy kwoty (500 + 500 = 1000)", async () => {
    vi.mocked(prisma.refund.aggregate).mockResolvedValueOnce({ _sum: { amount: null } });
    await validateRefundEligibility(prisma, {
      charge: baseCharge,
      integratorUserId: "int1",
      refundAmount: 500n,
      coveredBy: RefundCoveredBy.PLATFORM,
      composition: { platformCents: 1000n, connectedCredits: new Map() },
    });

    vi.mocked(prisma.refund.aggregate).mockResolvedValueOnce({ _sum: { amount: 500n } });
    await validateRefundEligibility(prisma, {
      charge: baseCharge,
      integratorUserId: "int1",
      refundAmount: 500n,
      coveredBy: RefundCoveredBy.PLATFORM,
      composition: { platformCents: 1000n, connectedCredits: new Map() },
    });
  });
});

describe("RefundService.createRefund — idempotencja Redis", () => {
  it("gdy SET NX nie ustawi klucza → IdempotencyConflictError (bez del Redis)", async () => {
    const redis = {
      set: vi.fn().mockResolvedValue(null),
      del: vi.fn(),
    };
    const service = new RefundService({} as PrismaClient);
    await expect(
      service.createRefund({
        redis: redis as never,
        integratorUserId: "u1",
        chargeId: "c1",
        amount: 1n,
        coveredBy: RefundCoveredBy.PLATFORM,
        idempotencyKey: "idem-duplicate",
        initiatedBy: "u1",
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(redis.del).not.toHaveBeenCalled();
  });
});

describe("getMarketplacePlatformUserId", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("zwraca APEXPAY_PLATFORM_USER_ID gdy ustawione", () => {
    vi.stubEnv("APEXPAY_PLATFORM_USER_ID", "plat_env_1");
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "plat_taxi");
    expect(getMarketplacePlatformUserId()).toBe("plat_env_1");
  });
});
