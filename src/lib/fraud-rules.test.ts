import { describe, expect, it, vi } from "vitest";
import { FraudRuleTriggered } from "@prisma/client";
import {
  ruleAccountAgeTooLow,
  ruleCardTesting,
  ruleDuplicateCharge,
  rulePayoutSpike,
  ruleRefundRateTooHigh,
  ruleUnusualAmount,
  ruleVelocityCharge,
  ruleVelocityPayout,
  type FraudContext,
} from "./fraud-rules.js";

const baseCtx = (overrides: Partial<FraudContext> & Pick<FraudContext, "entityType">): FraudContext => ({
  userId: "u1",
  amount: 1000n,
  currency: "PLN",
  prisma: {} as FraudContext["prisma"],
  ...overrides,
});

describe("fraud rules", () => {
  it("VELOCITY_CHARGE: > limit w godzinie", async () => {
    const prisma = {
      marketplaceCharge: {
        count: vi.fn().mockResolvedValue(11),
      },
    } as unknown as FraudContext["prisma"];
    const r = await ruleVelocityCharge(
      baseCtx({ entityType: "MarketplaceCharge", prisma }),
    );
    expect(r?.rule).toBe(FraudRuleTriggered.VELOCITY_CHARGE);
    expect(r?.score).toBe(40);
  });

  it("VELOCITY_CHARGE: pomija Payout", async () => {
    const r = await ruleVelocityCharge(
      baseCtx({
        entityType: "Payout",
        prisma: { marketplaceCharge: { count: vi.fn() } } as unknown as FraudContext["prisma"],
      }),
    );
    expect(r).toBeNull();
  });

  it("VELOCITY_PAYOUT: > limit dziennie", async () => {
    const prisma = {
      payout: {
        count: vi.fn().mockResolvedValue(4),
      },
    } as unknown as FraudContext["prisma"];
    const r = await ruleVelocityPayout(baseCtx({ entityType: "Payout", prisma }));
    expect(r?.rule).toBe(FraudRuleTriggered.VELOCITY_PAYOUT);
    expect(r?.score).toBe(50);
  });

  it("UNUSUAL_AMOUNT: < 3 transakcji historii", async () => {
    const prisma = {
      wallet: {
        findUnique: vi.fn().mockResolvedValue({ id: "w1" }),
      },
      transaction: {
        findMany: vi.fn().mockResolvedValue([{ amount: 100n }, { amount: 100n }]),
      },
    } as unknown as FraudContext["prisma"];
    const r = await ruleUnusualAmount(baseCtx({ prisma }));
    expect(r?.rule).toBe(FraudRuleTriggered.UNUSUAL_AMOUNT);
    expect(r?.score).toBe(20);
  });

  it("UNUSUAL_AMOUNT: przekroczenie mnożnika vs średnia", async () => {
    const prisma = {
      wallet: {
        findUnique: vi.fn().mockResolvedValue({ id: "w1" }),
      },
      transaction: {
        findMany: vi.fn().mockResolvedValue(
          Array.from({ length: 5 }, () => ({ amount: 1000n })),
        ),
      },
    } as unknown as FraudContext["prisma"];
    const r = await ruleUnusualAmount(
      baseCtx({ amount: 50_000n, prisma }),
    );
    expect(r?.rule).toBe(FraudRuleTriggered.UNUSUAL_AMOUNT);
    expect(r?.score).toBe(60);
  });

  it("DUPLICATE_CHARGE: ta sama kwota w oknie", async () => {
    const prisma = {
      marketplaceCharge: {
        count: vi.fn().mockResolvedValue(1),
      },
    } as unknown as FraudContext["prisma"];
    const r = await ruleDuplicateCharge(
      baseCtx({ entityType: "MarketplaceCharge", amount: 500n, prisma }),
    );
    expect(r?.rule).toBe(FraudRuleTriggered.DUPLICATE_CHARGE);
    expect(r?.score).toBe(70);
  });

  it("CARD_TESTING: wiele małych charge’ów", async () => {
    const prisma = {
      marketplaceCharge: {
        count: vi.fn().mockResolvedValue(4),
      },
    } as unknown as FraudContext["prisma"];
    const r = await ruleCardTesting(
      baseCtx({ entityType: "MarketplaceCharge", prisma }),
    );
    expect(r?.rule).toBe(FraudRuleTriggered.CARD_TESTING);
    expect(r?.score).toBe(80);
  });

  it("ACCOUNT_AGE_TOO_LOW: nowe konto + pierwszy duży charge", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          createdAt: new Date(Date.now() - 60 * 60 * 1000),
        }),
      },
      marketplaceCharge: {
        count: vi.fn().mockResolvedValue(0),
      },
    } as unknown as FraudContext["prisma"];
    const r = await ruleAccountAgeTooLow(
      baseCtx({
        entityType: "MarketplaceCharge",
        amount: 20_000n,
        prisma,
      }),
    );
    expect(r?.rule).toBe(FraudRuleTriggered.ACCOUNT_AGE_TOO_LOW);
    expect(r?.score).toBe(50);
  });

  it("REFUND_RATE_TOO_HIGH", async () => {
    const prisma = {
      marketplaceCharge: {
        count: vi.fn().mockResolvedValue(10),
      },
      refund: {
        count: vi.fn().mockResolvedValue(5),
      },
    } as unknown as FraudContext["prisma"];
    const r = await ruleRefundRateTooHigh(
      baseCtx({ entityType: "MarketplaceCharge", prisma }),
    );
    expect(r?.rule).toBe(FraudRuleTriggered.REFUND_RATE_TOO_HIGH);
    expect(r?.score).toBe(60);
  });

  it("PAYOUT_SPIKE", async () => {
    const prisma = {
      payout: {
        aggregate: vi
          .fn()
          .mockResolvedValueOnce({ _sum: { amount: 100_000n } })
          .mockResolvedValueOnce({ _sum: { amount: 30_000n } }),
      },
    } as unknown as FraudContext["prisma"];
    const r = await rulePayoutSpike(baseCtx({ entityType: "Payout", prisma }));
    expect(r?.rule).toBe(FraudRuleTriggered.PAYOUT_SPIKE);
    expect(r?.score).toBe(55);
  });
});
