import type { Request } from "express";
import {
  AuditAction,
  AuditActorType,
  Prisma,
  type PrismaClient,
  WebhookStatus,
} from "@prisma/client";
import {
  decodeCursor,
  paginatedResponse,
  parsePaginationLimit,
  type PaginatedSlice,
} from "../lib/pagination.js";
import type { AuditLogService } from "./audit-log.service.js";

const LAST_ERROR_MAX_LEN = 4096;

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
export async function archiveWebhookOutboxToDeadLetter(
  prisma: PrismaClient,
  row: {
    id: string;
    integratorUserId: string;
    eventType: string;
    payload: Prisma.JsonValue;
  },
  attempts: number,
  lastError: string,
  lastAttemptAt: Date,
): Promise<{ deadLetterId: string }> {
  const trimmedError =
    lastError.length > LAST_ERROR_MAX_LEN
      ? `${lastError.slice(0, LAST_ERROR_MAX_LEN)}…`
      : lastError;

    const created = await prisma.$transaction(async (tx) => {
      const dl = await tx.webhookDeadLetter.create({
        data: {
          integratorUserId: row.integratorUserId,
          eventType: row.eventType,
          payload: row.payload as Prisma.InputJsonValue,
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
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditLogService: AuditLogService,
    private readonly webhookPublish?: (outboxId: string) => Promise<void>,
  ) {}

  async listForAdmin(opts: {
    limit?: unknown;
    cursor?: string;
    integratorUserId?: string;
    requeued?: boolean;
    from?: Date;
    to?: Date;
  }): Promise<PaginatedSlice<WebhookDeadLetterListItem>> {
    const limit = parsePaginationLimit(opts.limit);
    const cursorDate = decodeCursor(opts.cursor);

    const createdAt: Prisma.DateTimeFilter = {};
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

  async requeueById(
    deadLetterId: string,
    adminUserId: string,
    req?: Request,
  ): Promise<{ outboxId: string }> {
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
          payload: dl.payload as Prisma.InputJsonValue,
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

      await this.auditLogService.log(
        tx,
        {
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
        },
        req,
      );

      return { outboxId: outbox.id };
    });

    if (this.webhookPublish !== undefined) {
      void this.webhookPublish(result.outboxId).catch((err: unknown) => {
        const m = err instanceof Error ? err.message : String(err);
        console.error("[WebhookDeadLetter] publish after requeue:", m);
      });
    }

    return result;
  }

  /** Liczba dead letters z ostatnich `hours` godzin, jeszcze bez ręcznego requeue. */
  async countRecentUnrequeued(hours: number): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.prisma.webhookDeadLetter.count({
      where: {
        requeued: false,
        createdAt: { gte: since },
      },
    });
  }
}
