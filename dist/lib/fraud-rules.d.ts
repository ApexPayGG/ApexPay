import type { PrismaClient } from "@prisma/client";
import { FraudRuleTriggered } from "@prisma/client";
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
/** Więcej niż N charge’ów integratora w ostatniej godzinie → kolejny jest (N+1)-szym. */
export declare function ruleVelocityCharge(ctx: FraudContext): Promise<RuleResult | null>;
/** Więcej niż N wypłat beneficjenta (user subkonta) w 24h. */
export declare function ruleVelocityPayout(ctx: FraudContext): Promise<RuleResult | null>;
export declare function ruleUnusualAmount(ctx: FraudContext): Promise<RuleResult | null>;
export declare function ruleDuplicateCharge(ctx: FraudContext): Promise<RuleResult | null>;
export declare function ruleCardTesting(ctx: FraudContext): Promise<RuleResult | null>;
export declare function ruleAccountAgeTooLow(ctx: FraudContext): Promise<RuleResult | null>;
export declare function ruleRefundRateTooHigh(ctx: FraudContext): Promise<RuleResult | null>;
export declare function rulePayoutSpike(ctx: FraudContext): Promise<RuleResult | null>;
export declare const ALL_FRAUD_RULES: Array<(ctx: FraudContext) => Promise<RuleResult | null>>;
//# sourceMappingURL=fraud-rules.d.ts.map