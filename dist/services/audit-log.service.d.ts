import type { Request } from "express";
import type { AuditAction, AuditActorType, AuditLog, Prisma, PrismaClient } from "@prisma/client";
export type AuditLogEntryInput = {
    actorId?: string | null;
    actorType: AuditActorType;
    action: AuditAction;
    entityType: string;
    entityId: string;
    metadata: Prisma.InputJsonValue;
    ipAddress?: string | null;
    userAgent?: string | null;
};
export type AuditListFilters = {
    actorId?: string;
    entityType?: string;
    entityId?: string;
    action?: AuditAction;
    from?: Date;
    to?: Date;
};
/**
 * Append-only audit log. `log` zawsze w ramach przekazanego `tx` (bez własnej transakcji).
 */
export declare class AuditLogService {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    log(tx: Prisma.TransactionClient, entry: AuditLogEntryInput, req?: Request): Promise<AuditLog>;
    /**
     * Paginacja kursorowa po `(createdAt desc, id desc)` — `cursor` to poprzedni `nextCursor`.
     */
    listForAdmin(filters: AuditListFilters, limit: number, cursorEncoded: string | undefined): Promise<{
        items: AuditLog[];
        nextCursor: string | null;
    }>;
}
//# sourceMappingURL=audit-log.service.d.ts.map