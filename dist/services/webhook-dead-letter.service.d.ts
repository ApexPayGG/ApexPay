import type { Request } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import { type PaginatedSlice } from "../lib/pagination.js";
import type { AuditLogService } from "./audit-log.service.js";
export type WebhookDeadLetterListItem = {
    id: string;
    integratorUserId: string;
    eventType: string;
    payload: Prisma.JsonValue;
    attempts: number;
    lastError: string;
    lastAttemptAt: Date;
    originalOutboxId: string | null;
    requeued: boolean;
    requeuedAt: Date | null;
    requeuedBy: string | null;
    createdAt: Date;
};
/**
 * Po wyczerpaniu prób dostawy usuwamy wpis z `WebhookOutbox` i zapisujemy `WebhookDeadLetter`.
 * Jeden zapis końcowy w DL (z `originalOutboxId`) zamiast nieskończonego FAILED w outbox —
 * worker i tak by go pomijał (`nextAttemptAt` w przyszłość); DL daje jawny widok operacyjny i requeue.
 */
export declare function archiveWebhookOutboxToDeadLetter(prisma: PrismaClient, row: {
    id: string;
    integratorUserId: string;
    eventType: string;
    payload: Prisma.JsonValue;
}, attempts: number, lastError: string, lastAttemptAt: Date): Promise<{
    deadLetterId: string;
}>;
export declare class WebhookDeadLetterAlreadyRequeuedError extends Error {
    constructor();
}
export declare class WebhookDeadLetterNotFoundError extends Error {
    constructor();
}
export declare class WebhookDeadLetterService {
    private readonly prisma;
    private readonly auditLogService;
    private readonly webhookPublish?;
    constructor(prisma: PrismaClient, auditLogService: AuditLogService, webhookPublish?: ((outboxId: string) => Promise<void>) | undefined);
    listForAdmin(opts: {
        limit?: unknown;
        cursor?: string;
        integratorUserId?: string;
        requeued?: boolean;
        from?: Date;
        to?: Date;
    }): Promise<PaginatedSlice<WebhookDeadLetterListItem>>;
    requeueById(deadLetterId: string, adminUserId: string, req?: Request): Promise<{
        outboxId: string;
    }>;
    /** Liczba dead letters z ostatnich `hours` godzin, jeszcze bez ręcznego requeue. */
    countRecentUnrequeued(hours: number): Promise<number>;
}
//# sourceMappingURL=webhook-dead-letter.service.d.ts.map