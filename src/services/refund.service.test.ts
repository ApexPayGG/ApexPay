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

describe("RefundService.createRefund — platform fee clawback target", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function buildRefundPrisma(opts: {
    charge: MarketplaceCharge;
    ledgerCredits: Array<{ referenceId: string; amount: bigint }>;
  }) {
    const walletUpdates: Array<{ where: { id?: string; userId?: string }; data: unknown }> =
      [];
    const walletsByUserId: Record<string, { id: string }> = {
      [opts.charge.debitUserId]: { id: "w_payer" },
      [opts.charge.integratorUserId]: { id: "w_integrator" },
      apex_platform: { id: "w_apex_platform" },
    };
    // When debitUserId === integratorUserId, same wallet id (matches production).
    if (opts.charge.debitUserId === opts.charge.integratorUserId) {
      walletsByUserId[opts.charge.integratorUserId] = { id: "w_integrator" };
    }

    const tx = {
      wallet: {
        findUnique: vi.fn(async ({ where }: { where: { userId?: string; id?: string } }) => {
          if (where.userId !== undefined) {
            return walletsByUserId[where.userId] ?? null;
          }
          return null;
        }),
        update: vi.fn(async (args: { where: { id?: string; userId?: string }; data: unknown }) => {
          walletUpdates.push(args);
          return {};
        }),
      },
      transaction: {
        findMany: vi.fn().mockResolvedValue(opts.ledgerCredits),
        create: vi.fn().mockResolvedValue({}),
      },
      refund: {
        create: vi.fn().mockResolvedValue({
          id: "refund-1",
          chargeId: opts.charge.id,
          amount: 1000n,
          currency: "PLN",
          status: "SUCCEEDED",
          coveredBy: RefundCoveredBy.PLATFORM,
          reason: null,
          initiatedBy: opts.charge.integratorUserId,
          idempotencyKey: "idem-plat",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
      },
      connectedAccount: {
        findUnique: vi.fn(),
      },
      webhookOutbox: {
        create: vi.fn().mockResolvedValue({ id: "wo-1" }),
      },
    };

    const prisma = {
      marketplaceCharge: {
        findUnique: vi.fn().mockResolvedValue(opts.charge),
      },
      refund: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
      },
      transaction: {
        findMany: vi.fn().mockResolvedValue(opts.ledgerCredits),
      },
      connectedAccount: {
        findUnique: vi.fn().mockResolvedValue({ id: "ca1" }),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;

    return { prisma, tx, walletUpdates, walletsByUserId };
  }

  it("coveredBy=PLATFORM debits integrator (fee recipient), never ApexPay platform wallet", async () => {
    vi.stubEnv("APEXPAY_PLATFORM_USER_ID", "apex_platform");
    const charge: MarketplaceCharge = {
      id: "ch-empty-split",
      debitUserId: "int1",
      integratorUserId: "int1",
      amountCents: 1000n,
      currency: "PLN",
      idempotencyKey: "ik-empty",
      createdAt: new Date(),
    };
    // Mirrors createIntegrationCharge with splits:[] — platform fee credited to integrator.
    const { prisma, walletUpdates } = buildRefundPrisma({
      charge,
      ledgerCredits: [
        { referenceId: `mkt:${charge.id}:credit:platform`, amount: 1000n },
      ],
    });
    const redis = { set: vi.fn().mockResolvedValue("OK"), del: vi.fn() };
    const service = new RefundService(prisma);

    await service.createRefund({
      redis: redis as never,
      integratorUserId: "int1",
      chargeId: charge.id,
      amount: 1000n,
      coveredBy: RefundCoveredBy.PLATFORM,
      idempotencyKey: "idem-plat-clawback",
      initiatedBy: "int1",
    });

    const debitUpdates = walletUpdates.filter(
      (u) =>
        u.data !== null &&
        typeof u.data === "object" &&
        "balance" in (u.data as object) &&
        typeof (u.data as { balance: unknown }).balance === "object" &&
        (u.data as { balance: { decrement?: bigint } }).balance.decrement !== undefined,
    );
    expect(debitUpdates.map((u) => u.where.id)).toEqual(["w_integrator"]);
    expect(debitUpdates.some((u) => u.where.id === "w_apex_platform")).toBe(false);
  });

  it("coveredBy=SPLIT claws platformCents from integrator, not ApexPay platform wallet", async () => {
    vi.stubEnv("APEXPAY_PLATFORM_USER_ID", "apex_platform");
    const charge: MarketplaceCharge = {
      id: "ch-split",
      debitUserId: "int1",
      integratorUserId: "int1",
      amountCents: 1000n,
      currency: "PLN",
      idempotencyKey: "ik-split",
      createdAt: new Date(),
    };
    const { prisma, tx, walletUpdates } = buildRefundPrisma({
      charge,
      ledgerCredits: [
        { referenceId: `mkt:${charge.id}:credit:platform`, amount: 200n },
        { referenceId: `mkt:${charge.id}:credit:ca1`, amount: 800n },
      ],
    });
    vi.mocked(tx.connectedAccount.findUnique).mockResolvedValue({
      userId: "seller1",
    } as never);
    // seller wallet for connected-account portion
    const findUnique = tx.wallet.findUnique as ReturnType<typeof vi.fn>;
    findUnique.mockImplementation(
      async ({ where }: { where: { userId?: string; id?: string } }) => {
        if (where.userId === "int1") return { id: "w_integrator" };
        if (where.userId === "seller1") return { id: "w_seller" };
        if (where.userId === "apex_platform") return { id: "w_apex_platform" };
        return null;
      },
    );

    const redis = { set: vi.fn().mockResolvedValue("OK"), del: vi.fn() };
    const service = new RefundService(prisma);

    await service.createRefund({
      redis: redis as never,
      integratorUserId: "int1",
      chargeId: charge.id,
      amount: 1000n,
      coveredBy: RefundCoveredBy.SPLIT,
      idempotencyKey: "idem-split-clawback",
      initiatedBy: "int1",
    });

    const debitIds = walletUpdates
      .filter(
        (u) =>
          u.data !== null &&
          typeof u.data === "object" &&
          "balance" in (u.data as object) &&
          typeof (u.data as { balance: unknown }).balance === "object" &&
          (u.data as { balance: { decrement?: bigint } }).balance.decrement !== undefined,
      )
      .map((u) => u.where.id);
    expect(debitIds).toContain("w_integrator");
    expect(debitIds).toContain("w_seller");
    expect(debitIds).not.toContain("w_apex_platform");
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
