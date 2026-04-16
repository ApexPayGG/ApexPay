import { AuditAction, AuditActorType, Prisma, WebhookStatus, } from "@prisma/client";
import { decodeCursor, paginatedResponse, parsePaginationLimit, } from "../lib/pagination.js";
const LAST_ERROR_MAX_LEN = 4096;
/**
 * Po wyczerpaniu prób dostawy usuwamy wpis z `WebhookOutbox` i zapisujemy `WebhookDeadLetter`.
 * Jeden zapis końcowy w DL (z `originalOutboxId`) zamiast nieskończonego FAILED w outbox —
 * worker i tak by go pomijał (`nextAttemptAt` w przyszłość); DL daje jawny widok operacyjny i requeue.
 */
export async function archiveWebhookOutboxToDeadLetter(prisma, row, attempts, lastError, lastAttemptAt) {
    const trimmedError = lastError.length > LAST_ERROR_MAX_LEN
        ? `${lastError.slice(0, LAST_ERROR_MAX_LEN)}…`
        : lastError;
    const created = await prisma.$transaction(async (tx) => {
        const dl = await tx.webhookDeadLetter.create({
            data: {
                integratorUserId: row.integratorUserId,
                eventType: row.eventType,
                payload: row.payload,
                attempts,
                lastError: trimmedError,
                lastAttemptAt,
                originalOutboxId: row.id,
            },
        });
        await tx.webhookOutbox.delete({ where: { id: row.id } });
        return dl;
    });
    return { deadLetterId: created.id };
}
export class WebhookDeadLetterAlreadyRequeuedError extends Error {
    constructor() {
        super("Dead letter został już ponownie zakolejkowany.");
        this.name = "WebhookDeadLetterAlreadyRequeuedError";
    }
}
export class WebhookDeadLetterNotFoundError extends Error {
    constructor() {
        super("Nie znaleziono dead letter.");
        this.name = "WebhookDeadLetterNotFoundError";
    }
}
export class WebhookDeadLetterService {
    prisma;
    auditLogService;
    webhookPublish;
    constructor(prisma, auditLogService, webhookPublish) {
        this.prisma = prisma;
        this.auditLogService = auditLogService;
        this.webhookPublish = webhookPublish;
    }
    async listForAdmin(opts) {
        const limit = parsePaginationLimit(opts.limit);
        const cursorDate = decodeCursor(opts.cursor);
        const createdAt = {};
        if (opts.from !== undefined) {
            createdAt.gte = opts.from;
        }
        if (opts.to !== undefined) {
            createdAt.lte = opts.to;
        }
        if (cursorDate !== undefined) {
            createdAt.lt = cursorDate;
        }
        const rows = await this.prisma.webhookDeadLetter.findMany({
            where: {
                ...(opts.integratorUserId !== undefined
                    ? { integratorUserId: opts.integratorUserId }
                    : {}),
                ...(opts.requeued !== undefined ? { requeued: opts.requeued } : {}),
                ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
            },
            orderBy: { createdAt: "desc" },
            take: limit + 1,
        });
        return paginatedResponse(rows, limit, (r) => r.createdAt);
    }
    async requeueById(deadLetterId, adminUserId, req) {
        const id = deadLetterId.trim();
        if (id.length === 0) {
            throw new RangeError("deadLetterId is required");
        }
        const result = await this.prisma.$transaction(async (tx) => {
            const dl = await tx.webhookDeadLetter.findUnique({ where: { id } });
            if (dl === null) {
                throw new WebhookDeadLetterNotFoundError();
            }
            if (dl.requeued) {
                throw new WebhookDeadLetterAlreadyRequeuedError();
            }
            const outbox = await tx.webhookOutbox.create({
                data: {
                    integratorUserId: dl.integratorUserId,
                    eventType: dl.eventType,
                    payload: dl.payload,
                    status: WebhookStatus.PENDING,
                    attempts: 0,
                    nextAttemptAt: new Date(),
                },
            });
            await tx.webhookDeadLetter.update({
                where: { id: dl.id },
                data: {
                    requeued: true,
                    requeuedAt: new Date(),
                    requeuedBy: adminUserId,
                },
            });
            await this.auditLogService.log(tx, {
                actorId: adminUserId,
                actorType: AuditActorType.ADMIN,
                action: AuditAction.WEBHOOK_REQUEUED,
                entityType: "WebhookDeadLetter",
                entityId: dl.id,
                metadata: {
                    newOutboxId: outbox.id,
                    integratorUserId: dl.integratorUserId,
                    eventType: dl.eventType,
                    originalOutboxId: dl.originalOutboxId,
                },
            }, req);
            return { outboxId: outbox.id };
        });
        if (this.webhookPublish !== undefined) {
            void this.webhookPublish(result.outboxId).catch((err) => {
                const m = err instanceof Error ? err.message : String(err);
                console.error("[WebhookDeadLetter] publish after requeue:", m);
            });
        }
        return result;
    }
    /** Liczba dead letters z ostatnich `hours` godzin, jeszcze bez ręcznego requeue. */
    async countRecentUnrequeued(hours) {
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);
        return this.prisma.webhookDeadLetter.count({
            where: {
                requeued: false,
                createdAt: { gte: since },
            },
        });
    }
}
//# sourceMappingURL=webhook-dead-letter.service.js.map