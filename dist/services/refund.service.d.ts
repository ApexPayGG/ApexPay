import type { Request } from "express";
import type { Redis } from "ioredis";
import type { MarketplaceCharge, PrismaClient, Refund } from "@prisma/client";
import { Prisma, RefundCoveredBy } from "@prisma/client";
import type { AuditLogService } from "./audit-log.service.js";
/** Redis: `idemp:refund:{Idempotency-Key}` */
export declare const REFUND_IDEMP_REDIS_PREFIX = "idemp:refund:";
/** Maks. okno zwrotu od `MarketplaceCharge.createdAt` (dni). */
export declare const REFUND_WINDOW_DAYS = 180;
export declare class RefundWindowExpiredError extends Error {
    constructor();
}
export declare class RefundAmountExceededError extends Error {
    constructor();
}
export declare class ChargeAlreadyFullyRefundedError extends Error {
    constructor();
}
export declare class RefundSplitAccountsMissingError extends Error {
    constructor();
}
export declare class RefundNoConnectedAccountsForCoverageError extends Error {
    constructor();
}
export declare class RefundChargeNotFoundError extends Error {
    constructor();
}
export declare class RefundForbiddenError extends Error {
    constructor();
}
export declare class RefundConfigurationError extends Error {
    constructor(message: string);
}
export type ChargeLedgerComposition = {
    /** Kwota „platform” z ledgera (`mkt:{id}:credit:platform`). */
    platformCents: bigint;
    /** Suma kredytów na subkonta (bez platform). */
    connectedCredits: Map<string, bigint>;
};
/**
 * Odczyt oryginalnego rozkładu charge z ledgera (kredyty po `MARKETPLACE_CONNECTED_CREDIT`).
 */
export declare function loadChargeLedgerComposition(prisma: PrismaClient | Prisma.TransactionClient, chargeId: string): Promise<ChargeLedgerComposition>;
export declare function getMarketplacePlatformUserId(): string;
/**
 * Rozkłada kwotę zwrotu proporcjonalnie do składowych oryginalnego charge (P + Σ S_i = original).
 */
export declare function allocateRefundCostSplit(refundAmount: bigint, chargeOriginal: bigint, platformCents: bigint, connectedCredits: Map<string, bigint>): {
    platformDebit: bigint;
    perConnectedAccount: Map<string, bigint>;
};
/**
 * Zwrot pokrywany wyłącznie przez subkonta — udział (R * S_i) / splitSum.
 */
export declare function allocateRefundCostConnectedOnly(refundAmount: bigint, connectedCredits: Map<string, bigint>): Map<string, bigint>;
export type ValidateRefundEligibilityInput = {
    charge: MarketplaceCharge;
    integratorUserId: string;
    refundAmount: bigint;
    coveredBy: RefundCoveredBy;
    /** Z ledgera — jeśli brak, wczytaj przed wywołaniem. */
    composition: ChargeLedgerComposition;
};
/**
 * Walidacja biznesowa zwrotu (okno czasowe, limity kwot, integralność splitu).
 */
export declare function validateRefundEligibility(prisma: PrismaClient, input: ValidateRefundEligibilityInput): Promise<void>;
export declare class RefundService {
    private readonly prisma;
    private readonly auditLogService?;
    private readonly webhookPublish?;
    constructor(prisma: PrismaClient, auditLogService?: AuditLogService | undefined, webhookPublish?: ((outboxId: string) => Promise<void>) | undefined);
    listForCharge(integratorUserId: string, chargeId: string): Promise<Refund[]>;
    createRefund(params: {
        redis: Redis;
        integratorUserId: string;
        chargeId: string;
        amount: bigint;
        coveredBy: RefundCoveredBy;
        reason?: string | undefined;
        idempotencyKey: string;
        initiatedBy: string;
        request?: Request | undefined;
    }): Promise<{
        refund: Refund;
    }>;
}
//# sourceMappingURL=refund.service.d.ts.map