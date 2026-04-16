import type { Dispute, Prisma, PrismaClient } from "@prisma/client";
import { DisputeStatus } from "@prisma/client";
import type { Redis } from "ioredis";
import { z } from "zod";
import type { AuditLogService } from "./audit-log.service.js";
/** Redis: `idemp:dispute:{pspDisputeId}` */
export declare const PSP_DISPUTE_IDEMP_REDIS_PREFIX = "idemp:dispute:";
export declare class DisputeChargeNotFoundError extends Error {
    constructor();
}
export declare class DisputeValidationError extends Error {
    constructor(message: string);
}
export declare class DisputeNotFoundError extends Error {
    constructor();
}
export declare class DisputeInvalidStateError extends Error {
    constructor(message?: string);
}
declare const pspDisputeWebhookSchema: z.ZodObject<{
    pspDisputeId: z.ZodString;
    chargeId: z.ZodString;
    reason: z.ZodEnum<{
        FRAUDULENT: "FRAUDULENT";
        DUPLICATE: "DUPLICATE";
        PRODUCT_NOT_RECEIVED: "PRODUCT_NOT_RECEIVED";
        PRODUCT_UNACCEPTABLE: "PRODUCT_UNACCEPTABLE";
        UNRECOGNIZED: "UNRECOGNIZED";
        CREDIT_NOT_PROCESSED: "CREDIT_NOT_PROCESSED";
        GENERAL: "GENERAL";
    }>;
    amount: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
    currency: z.ZodString;
    evidenceDueBy: z.ZodCoercedDate<unknown>;
}, z.core.$strict>;
export type PspDisputeWebhookPayload = z.infer<typeof pspDisputeWebhookSchema>;
export type DisputeListFilters = {
    status?: DisputeStatus;
    from?: Date;
    to?: Date;
};
export declare class DisputeService {
    private readonly prisma;
    private readonly redis;
    private readonly auditLogService?;
    private readonly webhookPublish?;
    constructor(prisma: PrismaClient, redis: Redis, auditLogService?: AuditLogService | undefined, webhookPublish?: ((outboxId: string) => Promise<void>) | undefined);
    parsePspWebhookBody(body: unknown): PspDisputeWebhookPayload;
    /**
     * Webhook PSP: idempotencja po `pspDisputeId` (Redis + unikalność w DB).
     * Księgowanie DISPUTE_HOLD na portfelu integratora (charge.integratorUserId).
     */
    createFromWebhook(payload: PspDisputeWebhookPayload): Promise<{
        dispute: Dispute;
        duplicate: boolean;
        webhookOutboxId: string | null;
    }>;
    submitEvidence(disputeId: string, evidence: Prisma.InputJsonValue, adminUserId: string): Promise<Dispute>;
    resolve(disputeId: string, outcome: "WON" | "LOST" | "ACCEPTED", adminUserId: string): Promise<{
        dispute: Dispute;
        webhookOutboxId: string | null;
    }>;
    /**
     * Lista sporów dla panelu admin — kursor `(createdAt desc, id desc)`.
     */
    listForAdmin(filters: DisputeListFilters, limit: number, cursorEncoded: string | undefined): Promise<{
        items: Dispute[];
        nextCursor: string | null;
    }>;
    getById(id: string): Promise<Dispute | null>;
    /**
     * Spory z nadchodzącym deadlinem dowodów (≤ 48 h, jeszcze nie minął).
     */
    findDisputesWithEvidenceDeadlineWithinHours(hours: number): Promise<Dispute[]>;
}
export {};
//# sourceMappingURL=dispute.service.d.ts.map