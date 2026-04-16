import type { PrismaClient } from "@prisma/client";
import { FraudRuleTriggered, RefundStatus } from "@prisma/client";

export type FraudEntityType = "MarketplaceCharge" | "Payout";

export type FraudContext = {
  userId: string;
  amount: bigint;
  currency: string;
  entityType: FraudEntityType;
  prisma: PrismaClient;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
};

export type RuleResult = {
  rule: FraudRuleTriggered;
  score: number;
  detail: string;
};

function envInt(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (v === undefined || v.length === 0) {
    return fallback;
  }
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (v === undefined || v.length === 0) {
    return fallback;
  }
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function absBigInt(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/** Więcej niż N charge’ów integratora w ostatniej godzinie → kolejny jest (N+1)-szym. */
export async function ruleVelocityCharge(ctx: FraudContext): Promise<RuleResult | null> {
  if (ctx.entityType !== "MarketplaceCharge") {
    return null;
  }
  const max = envInt("FRAUD_MAX_CHARGES_PER_HOUR", 10);
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const n = await ctx.prisma.marketplaceCharge.count({
    where: {
      integratorUserId: ctx.userId,
      createdAt: { gte: since },
    },
  });
  if (n > max) {
    return {
      rule: FraudRuleTriggered.VELOCITY_CHARGE,
      score: 40,
      detail: `Liczba charge’ów w ostatniej godzinie (${n}) przekracza limit ${max}.`,
    };
  }
  return null;
}

/** Więcej niż N wypłat beneficjenta (user subkonta) w 24h. */
export async function ruleVelocityPayout(ctx: FraudContext): Promise<RuleResult | null> {
  if (ctx.entityType !== "Payout") {
    return null;
  }
  const max = envInt("FRAUD_MAX_PAYOUTS_PER_DAY", 3);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const n = await ctx.prisma.payout.count({
    where: {
      createdAt: { gte: since },
      connectedAccount: { userId: ctx.userId },
    },
  });
  if (n > max) {
    return {
      rule: FraudRuleTriggered.VELOCITY_PAYOUT,
      score: 50,
      detail: `Liczba wypłat w ostatnich 24h (${n}) przekracza limit ${max}.`,
    };
  }
  return null;
}

export async function ruleUnusualAmount(ctx: FraudContext): Promise<RuleResult | null> {
  const mult = envFloat("FRAUD_UNUSUAL_AMOUNT_MULTIPLIER", 5);
  const wallet = await ctx.prisma.wallet.findUnique({
    where: { userId: ctx.userId },
    select: { id: true },
  });
  if (wallet === null) {
    return null;
  }
  const txs = await ctx.prisma.transaction.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { amount: true },
  });
  if (txs.length < 3) {
    return {
      rule: FraudRuleTriggered.UNUSUAL_AMOUNT,
      score: 20,
      detail: `Za mało historii transakcji (${txs.length} < 3) do stabilnej średniej.`,
    };
  }
  let sum = 0n;
  for (const t of txs) {
    sum += absBigInt(t.amount);
  }
  const avg = sum / BigInt(txs.length);
  if (avg === 0n) {
    return null;
  }
  if (ctx.amount > avg * BigInt(Math.floor(mult))) {
    return {
      rule: FraudRuleTriggered.UNUSUAL_AMOUNT,
      score: 60,
      detail: `Kwota ${ctx.amount.toString()} przekracza ${mult}× średnią ostatnich ${txs.length} transakcji (${avg.toString()}).`,
    };
  }
  return null;
}

export async function ruleDuplicateCharge(ctx: FraudContext): Promise<RuleResult | null> {
  if (ctx.entityType !== "MarketplaceCharge") {
    return null;
  }
  const windowMin = envInt("FRAUD_DUPLICATE_WINDOW_MINUTES", 5);
  const since = new Date(Date.now() - windowMin * 60 * 1000);
  const dupes = await ctx.prisma.marketplaceCharge.count({
    where: {
      integratorUserId: ctx.userId,
      amountCents: ctx.amount,
      createdAt: { gte: since },
    },
  });
  if (dupes >= 1) {
    return {
      rule: FraudRuleTriggered.DUPLICATE_CHARGE,
      score: 70,
      detail: `Wykryto wcześniejszy charge tej samej kwoty (${ctx.amount.toString()}) w oknie ${windowMin} min.`,
    };
  }
  return null;
}

export async function ruleCardTesting(ctx: FraudContext): Promise<RuleResult | null> {
  if (ctx.entityType !== "MarketplaceCharge") {
    return null;
  }
  const threshold = envInt("FRAUD_CARD_TESTING_THRESHOLD", 3);
  const maxAmount = BigInt(envInt("FRAUD_CARD_TESTING_MAX_AMOUNT", 500));
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const small = await ctx.prisma.marketplaceCharge.count({
    where: {
      integratorUserId: ctx.userId,
      amountCents: { lte: maxAmount },
      createdAt: { gte: since },
    },
  });
  if (small > threshold) {
    return {
      rule: FraudRuleTriggered.CARD_TESTING,
      score: 80,
      detail: `W ostatnich 10 min jest ${small} transakcji ≤ ${maxAmount.toString()} groszy (próg ${threshold}).`,
    };
  }
  return null;
}

export async function ruleAccountAgeTooLow(ctx: FraudContext): Promise<RuleResult | null> {
  if (ctx.entityType !== "MarketplaceCharge") {
    return null;
  }
  const minHours = envInt("FRAUD_MIN_ACCOUNT_AGE_HOURS", 24);
  const maxFirstAmount = BigInt(envInt("FRAUD_NEW_ACCOUNT_MAX_AMOUNT", 10_000));
  const user = await ctx.prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { createdAt: true },
  });
  if (user === null) {
    return null;
  }
  const ageMs = Date.now() - user.createdAt.getTime();
  if (ageMs >= minHours * 60 * 60 * 1000) {
    return null;
  }
  const prior = await ctx.prisma.marketplaceCharge.count({
    where: { integratorUserId: ctx.userId },
  });
  if (prior > 0) {
    return null;
  }
  if (ctx.amount <= maxFirstAmount) {
    return null;
  }
  return {
    rule: FraudRuleTriggered.ACCOUNT_AGE_TOO_LOW,
    score: 50,
    detail: `Konto integratora młodsze niż ${minHours}h i pierwszy charge powyżej ${maxFirstAmount.toString()} groszy.`,
  };
}

export async function ruleRefundRateTooHigh(ctx: FraudContext): Promise<RuleResult | null> {
  if (ctx.entityType !== "MarketplaceCharge") {
    return null;
  }
  const maxRate = envFloat("FRAUD_MAX_REFUND_RATE", 0.3);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const chargeCount = await ctx.prisma.marketplaceCharge.count({
    where: {
      integratorUserId: ctx.userId,
      createdAt: { gte: since },
    },
  });
  if (chargeCount < 5) {
    return null;
  }
  const refundCount = await ctx.prisma.refund.count({
    where: {
      status: RefundStatus.SUCCEEDED,
      createdAt: { gte: since },
      charge: { integratorUserId: ctx.userId },
    },
  });
  const rate = refundCount / chargeCount;
  if (rate > maxRate) {
    return {
      rule: FraudRuleTriggered.REFUND_RATE_TOO_HIGH,
      score: 60,
      detail: `Stosunek refundów do charge’ów (30 dni): ${(rate * 100).toFixed(1)}% > ${(maxRate * 100).toFixed(0)}%.`,
    };
  }
  return null;
}

export async function rulePayoutSpike(ctx: FraudContext): Promise<RuleResult | null> {
  if (ctx.entityType !== "Payout") {
    return null;
  }
  const mult = envFloat("FRAUD_PAYOUT_SPIKE_MULTIPLIER", 3);
  const day24 = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const day30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const sum24 = await ctx.prisma.payout.aggregate({
    where: {
      createdAt: { gte: day24 },
      connectedAccount: { userId: ctx.userId },
    },
    _sum: { amount: true },
  });
  const sum30 = await ctx.prisma.payout.aggregate({
    where: {
      createdAt: { gte: day30 },
      connectedAccount: { userId: ctx.userId },
    },
    _sum: { amount: true },
  });

  const s24 = sum24._sum.amount ?? 0n;
  const s30 = sum30._sum.amount ?? 0n;
  const avgDaily = s30 / 30n;
  if (avgDaily === 0n) {
    return null;
  }
  if (s24 > avgDaily * BigInt(Math.floor(mult))) {
    return {
      rule: FraudRuleTriggered.PAYOUT_SPIKE,
      score: 55,
      detail: `Suma wypłat 24h (${s24.toString()}) przekracza ${mult}× średnią dzienną z 30 dni (${avgDaily.toString()}).`,
    };
  }
  return null;
}

export const ALL_FRAUD_RULES: Array<
  (ctx: FraudContext) => Promise<RuleResult | null>
> = [
  ruleVelocityCharge,
  ruleVelocityPayout,
  ruleUnusualAmount,
  ruleDuplicateCharge,
  ruleCardTesting,
  ruleAccountAgeTooLow,
  ruleRefundRateTooHigh,
  rulePayoutSpike,
];
