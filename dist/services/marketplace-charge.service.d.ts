import type { Request } from "express";
import type { Redis } from "ioredis";
import type { MarketplaceCharge } from "@prisma/client";
import { type PrismaClient, ConnectedAccountStatus } from "@prisma/client";
import type { AuditLogService } from "./audit-log.service.js";
import { type PaginatedSlice } from "../lib/pagination.js";
import type { FraudDetectionService } from "./fraud-detection.service.js";
export declare class MarketplaceValidationError extends Error {
    constructor(message: string);
}
export declare class ConnectedAccountNotFoundError extends Error {
    constructor();
}
export declare class ConnectedAccountInactiveError extends Error {
    constructor();
}
export declare class ConnectedAccountIntegratorMismatchError extends Error {
    constructor();
}
export declare class IdempotencyConflictError extends Error {
    constructor();
}
export declare class PaymentMethodNotOwnedError extends Error {
    constructor();
}
/** Prefiks Redis: `idemp:mkt-charge:{Idempotency-Key}` */
export declare const INTEGRATION_CHARGE_IDEMP_REDIS_PREFIX = "idemp:mkt-charge:";
export type SplitLine = {
    connectedAccountId: string;
    amountCents: bigint;
};
/** Łączy powtórzone connectedAccountId; rzuca MarketplaceValidationError przy błędzie. */
export declare function mergeSplitLines(splits: SplitLine[]): Map<string, bigint>;
/** Split B2B: suma ≤ amount; pusta tablica = całość jako opłata platformy. */
export declare function mergeIntegrationSplitLines(splits: SplitLine[]): Map<string, bigint>;
export type IntegrationChargeListItem = {
    id: string;
    amountCents: bigint;
    currency: string;
    createdAt: Date;
    connectedAccountIds: string[];
};
/**
 * Sandbox / MVP: jeden debit z portfela płatnika → kredyty na subkonta (ACTIVE).
 * Idempotencja po opcjonalnym idempotencyKey (nagłówek lub body).
 */
export declare class MarketplaceChargeService {
    private readonly prisma;
    private readonly webhookPublish?;
    private readonly auditLogService?;
    private readonly fraudDetectionService?;
    constructor(prisma: PrismaClient, webhookPublish?: ((outboxId: string) => Promise<void>) | undefined, auditLogService?: AuditLogService | undefined, fraudDetectionService?: FraudDetectionService | undefined);
    /**
     * Charge B2B (klucz API): debit portfela integratora o `amountCents`, split na subkonta,
     * reszta jako prowizja na portfel integratora. Idempotencja: Redis NX + unikalny klucz w DB.
     */
    createIntegrationCharge(params: {
        redis: Redis;
        integratorUserId: string;
        idempotencyKey: string;
        amountCents: bigint;
        currency: string;
        splits: SplitLine[];
        paymentMethodId?: string | undefined;
        /** Opcjonalnie — IP / User-Agent do audytu. */
        request?: Request | undefined;
    }): Promise<{
        charge: MarketplaceCharge;
    }>;
    createConnectedAccount(userId: string): Promise<{
        id: string;
    }>;
    setConnectedAccountStatus(accountId: string, status: ConnectedAccountStatus): Promise<void>;
    chargeSplit(params: {
        debitUserId: string;
        amountCents: bigint;
        splits: SplitLine[];
        idempotencyKey?: string | undefined;
    }): Promise<{
        chargeId: string;
        idempotent: boolean;
    }>;
    /**
     * Lista charge’ów integratora (B2B) z ID subkont z ledgera (`mkt:…:credit:`), malejąco po `createdAt`.
     */
    listForIntegration(integratorUserId: string, opts?: {
        limit?: unknown;
        cursor?: string;
    }): Promise<PaginatedSlice<IntegrationChargeListItem>>;
}
//# sourceMappingURL=marketplace-charge.service.d.ts.map