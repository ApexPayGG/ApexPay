import type { Dispute, Prisma, PrismaClient } from "@prisma/client";
import {
  AuditAction,
  AuditActorType,
  DisputeReason,
  DisputeStatus,
  Prisma as PrismaNs,
  TransactionType as TxType,
} from "@prisma/client";
import type { Redis } from "ioredis";
import { z } from "zod";
import { contextLogger } from "../lib/logger.js";
import { isInsufficientFundsDbError } from "../lib/prisma-wallet-errors.js";
import type { AuditLogService } from "./audit-log.service.js";
import { InsufficientFundsError, WalletNotFoundError } from "./wallet.service.js";

/** Redis: `idemp:dispute:{pspDisputeId}` */
export const PSP_DISPUTE_IDEMP_REDIS_PREFIX = "idemp:dispute:";

const IDEMP_TTL_SEC = 86_400;

export class DisputeChargeNotFoundError extends Error {
  constructor() {
    super("Nie znaleziono charge dla sporu.");
    this.name = "DisputeChargeNotFoundError";
  }
}

export class DisputeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisputeValidationError";
  }
}

export class DisputeNotFoundError extends Error {
  constructor() {
    super("Spór nie istnieje.");
    this.name = "DisputeNotFoundError";
  }
}

export class DisputeInvalidStateError extends Error {
  constructor(message = "Spór jest w nieprawidłowym stanie.") {
    super(message);
    this.name = "DisputeInvalidStateError";
  }
}

const pspDisputeWebhookSchema = z
  .object({
    pspDisputeId: z.string().trim().min(1).max(256),
    chargeId: z.string().trim().min(1).max(128),
    reason: z.nativeEnum(DisputeReason),
    amount: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
    currency: z.string().trim().min(1).max(16),
    evidenceDueBy: z.coerce.date(),
  })
  .strict();

export type PspDisputeWebhookPayload = z.infer<typeof pspDisputeWebhookSchema>;

function toPositiveBigInt(amount: number | string | bigint): bigint {
  if (typeof amount === "bigint") {
    if (amount <= 0n) {
      throw new RangeError("amount must be positive");
    }
    return amount;
  }
  if (typeof amount === "number") {
    return BigInt(amount);
  }
  return BigInt(amount);
}

const OPEN_DISPUTE_STATUSES: DisputeStatus[] = [
  DisputeStatus.RECEIVED,
  DisputeStatus.UNDER_REVIEW,
  DisputeStatus.EVIDENCE_SUBMITTED,
];

function isOpenDispute(status: DisputeStatus): boolean {
  return OPEN_DISPUTE_STATUSES.includes(status);
}

export type DisputeListFilters = {
  status?: DisputeStatus;
  from?: Date;
  to?: Date;
};

export class DisputeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly auditLogService?: AuditLogService,
    private readonly webhookPublish?: (outboxId: string) => Promise<void>,
  ) {}

  parsePspWebhookBody(body: unknown): PspDisputeWebhookPayload {
    return pspDisputeWebhookSchema.parse(body);
  }

  /**
   * Webhook PSP: idempotencja po `pspDisputeId` (Redis + unikalność w DB).
   * Księgowanie DISPUTE_HOLD na portfelu integratora (charge.integratorUserId).
   */
  async createFromWebhook(
    payload: PspDisputeWebhookPayload,
  ): Promise<{ dispute: Dispute; duplicate: boolean; webhookOutboxId: string | null }> {
    const pspDisputeId = payload.pspDisputeId.trim();
    const amount = toPositiveBigInt(payload.amount);
    const currency = payload.currency.trim().toUpperCase();
    const evidenceDueBy = payload.evidenceDueBy;

    const existing = await this.prisma.dispute.findUnique({
      where: { pspDisputeId },
    });
    if (existing !== null) {
      return { dispute: existing, duplicate: true, webhookOutboxId: null };
    }

    const idempKey = `${PSP_DISPUTE_IDEMP_REDIS_PREFIX}${pspDisputeId}`;
    const setOk = await this.redis.set(idempKey, "1", "EX", IDEMP_TTL_SEC, "NX");
    if (setOk !== "OK") {
      const again = await this.prisma.dispute.findUnique({
        where: { pspDisputeId },
      });
      if (again !== null) {
        return { dispute: again, duplicate: true, webhookOutboxId: null };
      }
      throw new DisputeValidationError("Powtórka webhooka — spróbuj ponownie.");
    }

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const charge = await tx.marketplaceCharge.findUnique({
            where: { id: payload.chargeId.trim() },
          });
          if (charge === null) {
            throw new DisputeChargeNotFoundError();
          }
          if (charge.currency.toUpperCase() !== currency) {
            throw new DisputeValidationError("Niezgodna waluta charge ze sporu.");
          }
          if (amount > charge.amountCents) {
            throw new DisputeValidationError("Kwota sporu nie może przekraczać kwoty charge.");
          }

          const integratorWallet = await tx.wallet.findUnique({
            where: { userId: charge.integratorUserId },
            select: { id: true },
          });
          if (integratorWallet === null) {
            throw new WalletNotFoundError();
          }

          try {
            await tx.wallet.update({
              where: { userId: charge.integratorUserId },
              data: { balance: { decrement: amount } },
            });
          } catch (err) {
            if (isInsufficientFundsDbError(err)) {
              throw new InsufficientFundsError();
            }
            throw err;
          }

          const disputeRow = await tx.dispute.create({
            data: {
              chargeId: charge.id,
              pspDisputeId,
              status: DisputeStatus.RECEIVED,
              reason: payload.reason,
              amount,
              currency,
              evidenceDueBy,
              integratorNotifiedAt: new Date(),
            },
          });

          await tx.transaction.create({
            data: {
              walletId: integratorWallet.id,
              amount: -amount,
              referenceId: `disp:${disputeRow.id}:hold`,
              type: TxType.DISPUTE_HOLD,
            },
          });

          const wo = await tx.webhookOutbox.create({
            data: {
              integratorUserId: charge.integratorUserId,
              eventType: "dispute.created",
              payload: {
                disputeId: disputeRow.id,
                chargeId: charge.id,
                amount: disputeRow.amount.toString(),
                reason: disputeRow.reason,
                evidenceDueBy: disputeRow.evidenceDueBy.toISOString(),
              },
            },
          });

          if (this.auditLogService !== undefined) {
            await this.auditLogService.log(
              tx,
              {
                actorType: AuditActorType.PSP,
                action: AuditAction.DISPUTE_CREATED,
                entityType: "Dispute",
                entityId: disputeRow.id,
                metadata: {
                  chargeId: charge.id,
                  pspDisputeId,
                  amount: disputeRow.amount.toString(),
                  currency: disputeRow.currency,
                },
              },
              undefined,
            );
          }

          return { dispute: disputeRow, webhookOutboxId: wo.id };
        },
        {
          isolationLevel: PrismaNs.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 20_000,
        },
      );

      if (this.webhookPublish !== undefined) {
        void this.webhookPublish(result.webhookOutboxId).catch((err: unknown) => {
          contextLogger().warn(
            { err: err instanceof Error ? err.message : String(err) },
            "dispute.created: webhook publish failed",
          );
        });
      }

      return { dispute: result.dispute, duplicate: false, webhookOutboxId: result.webhookOutboxId };
    } catch (err) {
      await this.redis.del(idempKey);
      if (err instanceof PrismaNs.PrismaClientKnownRequestError && err.code === "P2002") {
        const again = await this.prisma.dispute.findUnique({
          where: { pspDisputeId },
        });
        if (again !== null) {
          return { dispute: again, duplicate: true, webhookOutboxId: null };
        }
      }
      throw err;
    }
  }

  async submitEvidence(
    disputeId: string,
    evidence: Prisma.InputJsonValue,
    adminUserId: string,
  ): Promise<Dispute> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.dispute.findUnique({ where: { id: disputeId } });
      if (row === null) {
        throw new DisputeNotFoundError();
      }
      if (!isOpenDispute(row.status)) {
        throw new DisputeInvalidStateError();
      }

      const updated = await tx.dispute.update({
        where: { id: disputeId },
        data: {
          evidence,
          status: DisputeStatus.EVIDENCE_SUBMITTED,
        },
      });

      if (this.auditLogService !== undefined) {
        await this.auditLogService.log(
          tx,
          {
            actorId: adminUserId,
            actorType: AuditActorType.ADMIN,
            action: AuditAction.DISPUTE_EVIDENCE_SUBMITTED,
            entityType: "Dispute",
            entityId: disputeId,
            metadata: {},
          },
          undefined,
        );
      }

      return updated;
    });
  }

  async resolve(
    disputeId: string,
    outcome: "WON" | "LOST" | "ACCEPTED",
    adminUserId: string,
  ): Promise<{ dispute: Dispute; webhookOutboxId: string | null }> {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const row = await tx.dispute.findUnique({
          where: { id: disputeId },
          include: { charge: true },
        });
        if (row === null) {
          throw new DisputeNotFoundError();
        }
        if (!isOpenDispute(row.status)) {
          throw new DisputeInvalidStateError("Spór został już rozstrzygnięty.");
        }

        const integratorUserId = row.charge.integratorUserId;
        const integratorWallet = await tx.wallet.findUnique({
          where: { userId: integratorUserId },
          select: { id: true },
        });
        if (integratorWallet === null) {
          throw new WalletNotFoundError();
        }

        const amount = row.amount;
        const now = new Date();

        if (outcome === "WON") {
          await tx.wallet.update({
            where: { userId: integratorUserId },
            data: { balance: { increment: amount } },
          });
          await tx.transaction.create({
            data: {
              walletId: integratorWallet.id,
              amount,
              referenceId: `disp:${row.id}:hold_release`,
              type: TxType.DISPUTE_HOLD_RELEASE,
            },
          });

          const updated = await tx.dispute.update({
            where: { id: disputeId },
            data: {
              status: DisputeStatus.WON,
              resolvedAt: now,
            },
          });

          const wo = await tx.webhookOutbox.create({
            data: {
              integratorUserId,
              eventType: "dispute.won",
              payload: {
                disputeId: row.id,
                chargeId: row.chargeId,
                amount: amount.toString(),
                resolvedAt: now.toISOString(),
              },
            },
          });

          if (this.auditLogService !== undefined) {
            await this.auditLogService.log(
              tx,
              {
                actorId: adminUserId,
                actorType: AuditActorType.ADMIN,
                action: AuditAction.DISPUTE_RESOLVED,
                entityType: "Dispute",
                entityId: disputeId,
                metadata: { outcome: "WON" },
              },
              undefined,
            );
          }

          return { dispute: updated, webhookOutboxId: wo.id };
        }

        // LOST / ACCEPTED: zwolnienie holdu i natychmiastowe obciążenie końcowe — saldo jak po DISPUTE_HOLD.
        await tx.wallet.update({
          where: { userId: integratorUserId },
          data: { balance: { increment: amount } },
        });
        await tx.transaction.create({
          data: {
            walletId: integratorWallet.id,
            amount,
            referenceId: `disp:${row.id}:hold_release`,
            type: TxType.DISPUTE_HOLD_RELEASE,
          },
        });
        await tx.wallet.update({
          where: { userId: integratorUserId },
          data: { balance: { decrement: amount } },
        });
        await tx.transaction.create({
          data: {
            walletId: integratorWallet.id,
            amount: -amount,
            referenceId: `disp:${row.id}:final`,
            type: TxType.DISPUTE_DEBIT_FINAL,
          },
        });

        const status =
          outcome === "LOST" ? DisputeStatus.LOST : DisputeStatus.ACCEPTED;
        const eventType =
          outcome === "LOST" ? "dispute.lost" : "dispute.accepted";

        const updated = await tx.dispute.update({
          where: { id: disputeId },
          data: {
            status,
            resolvedAt: now,
          },
        });

        const wo = await tx.webhookOutbox.create({
          data: {
            integratorUserId,
            eventType,
            payload: {
              disputeId: row.id,
              chargeId: row.chargeId,
              amount: amount.toString(),
              resolvedAt: now.toISOString(),
            },
          },
        });

        if (this.auditLogService !== undefined) {
          await this.auditLogService.log(
            tx,
            {
              actorId: adminUserId,
              actorType: AuditActorType.ADMIN,
              action: AuditAction.DISPUTE_RESOLVED,
              entityType: "Dispute",
              entityId: disputeId,
              metadata: { outcome },
            },
            undefined,
          );
        }

        return { dispute: updated, webhookOutboxId: wo.id };
      },
      {
        isolationLevel: PrismaNs.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 20_000,
      },
    );

    if (this.webhookPublish !== undefined && result.webhookOutboxId !== null) {
      void this.webhookPublish(result.webhookOutboxId).catch((err: unknown) => {
        contextLogger().warn(
          { err: err instanceof Error ? err.message : String(err) },
          "dispute resolved: webhook publish failed",
        );
      });
    }

    return result;
  }

  /**
   * Lista sporów dla panelu admin — kursor `(createdAt desc, id desc)`.
   */
  async listForAdmin(
    filters: DisputeListFilters,
    limit: number,
    cursorEncoded: string | undefined,
  ): Promise<{ items: Dispute[]; nextCursor: string | null }> {
    const take = Math.min(100, Math.max(1, limit));

    let cursor: { createdAt: string; id: string } | undefined;
    if (cursorEncoded !== undefined && cursorEncoded.trim().length > 0) {
      try {
        const raw = Buffer.from(cursorEncoded.trim(), "base64url").toString("utf8");
        const parsed = JSON.parse(raw) as { createdAt?: unknown; id?: unknown };
        if (
          typeof parsed.createdAt === "string" &&
          typeof parsed.id === "string" &&
          parsed.id.length > 0
        ) {
          cursor = { createdAt: parsed.createdAt, id: parsed.id };
        }
      } catch {
        cursor = undefined;
      }
    }

    const parts: Prisma.DisputeWhereInput[] = [];
    if (filters.status !== undefined) {
      parts.push({ status: filters.status });
    }
    if (filters.from !== undefined || filters.to !== undefined) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (filters.from !== undefined) {
        createdAt.gte = filters.from;
      }
      if (filters.to !== undefined) {
        createdAt.lte = filters.to;
      }
      parts.push({ createdAt });
    }
    if (cursor !== undefined) {
      const d = new Date(cursor.createdAt);
      if (!Number.isNaN(d.getTime())) {
        parts.push({
          OR: [
            { createdAt: { lt: d } },
            { AND: [{ createdAt: d }, { id: { lt: cursor.id } }] },
          ],
        });
      }
    }

    const where: Prisma.DisputeWhereInput =
      parts.length > 0 ? { AND: parts } : {};

    const rows = await this.prisma.dispute.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const slice = hasMore ? rows.slice(0, take) : rows;
    let nextCursor: string | null = null;
    if (hasMore && slice.length > 0) {
      const last = slice[slice.length - 1]!;
      nextCursor = Buffer.from(
        JSON.stringify({
          createdAt: last.createdAt.toISOString(),
          id: last.id,
        }),
        "utf8",
      ).toString("base64url");
    }

    return { items: slice, nextCursor };
  }

  async getById(id: string): Promise<Dispute | null> {
    return this.prisma.dispute.findUnique({ where: { id } });
  }

  /**
   * Spory z nadchodzącym deadlinem dowodów (≤ 48 h, jeszcze nie minął).
   */
  async findDisputesWithEvidenceDeadlineWithinHours(
    hours: number,
  ): Promise<Dispute[]> {
    const now = new Date();
    const horizon = new Date(now.getTime() + hours * 60 * 60 * 1000);
    return this.prisma.dispute.findMany({
      where: {
        status: { in: [DisputeStatus.RECEIVED, DisputeStatus.UNDER_REVIEW] },
        evidenceDueBy: { lte: horizon, gte: now },
      },
      orderBy: { evidenceDueBy: "asc" },
    });
  }
}
