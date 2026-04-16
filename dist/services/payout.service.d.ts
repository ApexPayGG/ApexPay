import type { Request } from "express";
import type { Redis } from "ioredis";
import type { Payout, PrismaClient } from "@prisma/client";
import { PayoutStatus } from "@prisma/client";
import type { AuditLogService } from "./audit-log.service.js";
import type { FraudDetectionService } from "./fraud-detection.service.js";
import { type PaginatedSlice } from "../lib/pagination.js";
/** Prefiks Redis: `idemp:payout:{Idempotency-Key}` */
export declare const PAYOUT_IDEMP_REDIS_PREFIX = "idemp:payout:";
export declare class PayoutNotFoundError extends Error {
    constructor();
}
export declare class PayoutInvalidStateError extends Error {
    constructor();
}
export type IntegrationPayoutListItem = {
    id: string;
    amount: bigint;
    currency: string;
    status: PayoutStatus;
    createdAt: Date;
    connectedAccountId: string;
    connectedAccountEmail: string;
};
export declare class PayoutService {
    private readonly prisma;
    private readonly webhookPublish?;
    private readonly auditLogService?;
    private readonly fraudDetectionService?;
    constructor(prisma: PrismaClient, webhookPublish?: ((outboxId: string) => Promise<void>) | undefined, auditLogService?: AuditLogService | undefined, fraudDetectionService?: FraudDetectionService | undefined);
    /**
     * Rozliczenie wypłaty przez admina / proces: PAID (sukces PSP) lub FAILED ze zwrotem na portfel subkonta.
     */
    settlePayout(payoutId: string, outcome: "PAID" | "FAILED", pspReferenceId?: string | null, audit?: {
        request?: Request | undefined;
        adminUserId?: string | undefined;
    }): Promise<Payout>;
    createPayout(params: {
        redis: Redis;
        integratorUserId: string;
        idempotencyKey: string;
        connectedAccountId: string;
        amount: bigint;
        currency?: string | undefined;
        request?: Request | undefined;
    }): Promise<{
        payout: Payout;
    }>;
    /**
     * Wypłaty powiązane z subkontami integratora, malejąco po `createdAt`.
     */
    listForIntegration(integratorUserId: string, opts?: {
        limit?: unknown;
        cursor?: string;
    }): Promise<PaginatedSlice<IntegrationPayoutListItem>>;
}
//# sourceMappingURL=payout.service.d.ts.map