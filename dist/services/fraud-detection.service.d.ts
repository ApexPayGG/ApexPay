import type { FraudCheck } from "@prisma/client";
import { FraudCheckStatus, type PrismaClient } from "@prisma/client";
import { type FraudContext } from "../lib/fraud-rules.js";
import type { AuditLogService } from "./audit-log.service.js";
export declare class FraudBlockedError extends Error {
    readonly fraudCheckId: string;
    readonly score: number;
    constructor(fraudCheckId: string, score: number, message?: string);
}
export declare class FraudCheckNotFoundError extends Error {
    constructor();
}
export type FraudCheckResult = {
    status: FraudCheckStatus;
    score: number;
    rulesTriggered: Array<{
        rule: string;
        score: number;
        detail: string;
    }>;
    fraudCheckId: string;
};
export type FraudListFilters = {
    status?: FraudCheckStatus;
    userId?: string;
    entityType?: string;
    from?: Date;
    to?: Date;
};
export declare class FraudDetectionService {
    private readonly prisma;
    private readonly auditLogService?;
    constructor(prisma: PrismaClient, auditLogService?: AuditLogService | undefined);
    /**
     * Ocena reguł (równolegle), scoring 0–100, zapis `FraudCheck` (osobna transakcja — niezależna od charge/payout).
     */
    evaluate(context: FraudContext): Promise<FraudCheckResult>;
    reviewFraudCheck(fraudCheckId: string, adminUserId: string, decision: "APPROVE" | "CONFIRM_FRAUD"): Promise<FraudCheck>;
    listForAdmin(filters: FraudListFilters, limit: number, cursorEncoded: string | undefined): Promise<{
        items: FraudCheck[];
        nextCursor: string | null;
    }>;
    getById(id: string): Promise<FraudCheck | null>;
    /** FLAGGED, utworzone w ostatniej godzinie, bez przeglądu — monitoring. */
    countUnreviewedFlaggedRecent(hoursBack: number): Promise<number>;
}
//# sourceMappingURL=fraud-detection.service.d.ts.map