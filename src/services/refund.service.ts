import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Request } from "express";
import type { Redis } from "ioredis";
import type { MarketplaceCharge, PrismaClient, Refund } from "@prisma/client";
import {
  Prisma,
  AuditAction,
  AuditActorType,
  RefundCoveredBy,
  RefundStatus,
  TransactionType as TxType,
} from "@prisma/client";
import { contextLogger } from "../lib/logger.js";
import { isInsufficientFundsDbError } from "../lib/prisma-wallet-errors.js";
import type { AuditLogService } from "./audit-log.service.js";
import { IdempotencyConflictError } from "./marketplace-charge.service.js";
import { InsufficientFundsError, WalletNotFoundError } from "./wallet.service.js";

/** Redis: `idemp:refund:{Idempotency-Key}` */
export const REFUND_IDEMP_REDIS_PREFIX = "idemp:refund:";

/** Maks. okno zwrotu od `MarketplaceCharge.createdAt` (dni). */
export const REFUND_WINDOW_DAYS = 180;

export class RefundWindowExpiredError extends Error {
  constructor() {
    super("Upłynął limit 180 dni na zwrot dla tego charge.");
    this.name = "RefundWindowExpiredError";
  }
}

export class RefundAmountExceededError extends Error {
  constructor() {
    super("Suma zwrotów przekroczyłaby kwotę oryginalnego charge.");
    this.name = "RefundAmountExceededError";
  }
}

export class ChargeAlreadyFullyRefundedError extends Error {
  constructor() {
    super("Charge został już w pełni zwrócony.");
    this.name = "ChargeAlreadyFullyRefundedError";
  }
}

export class RefundSplitAccountsMissingError extends Error {
  constructor() {
    super("Brak co najmniej jednego subkonta z oryginalnego splitu — zwrot SPLIT niedozwolony.");
    this.name = "RefundSplitAccountsMissingError";
  }
}

export class RefundNoConnectedAccountsForCoverageError extends Error {
  constructor() {
    super("Brak subkont powiązanych z charge — coveredBy CONNECTED_ACCOUNT jest niedostępny.");
    this.name = "RefundNoConnectedAccountsForCoverageError";
  }
}

export class RefundChargeNotFoundError extends Error {
  constructor() {
    super("Nie znaleziono charge.");
    this.name = "RefundChargeNotFoundError";
  }
}

export class RefundForbiddenError extends Error {
  constructor() {
    super("Charge nie należy do tego integratora.");
    this.name = "RefundForbiddenError";
  }
}

export class RefundConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefundConfigurationError";
  }
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
export async function loadChargeLedgerComposition(
  prisma: PrismaClient | Prisma.TransactionClient,
  chargeId: string,
): Promise<ChargeLedgerComposition> {
  const prefix = `mkt:${chargeId}:credit:`;
  const rows = await prisma.transaction.findMany({
    where: { referenceId: { startsWith: prefix } },
    select: { referenceId: true, amount: true },
  });

  let platformCents = 0n;
  const connectedCredits = new Map<string, bigint>();

  for (const r of rows) {
    const tail = r.referenceId.slice(prefix.length);
    if (tail === "platform") {
      platformCents += r.amount;
    } else if (tail.length > 0) {
      connectedCredits.set(tail, (connectedCredits.get(tail) ?? 0n) + r.amount);
    }
  }

  return { platformCents, connectedCredits };
}

export function getMarketplacePlatformUserId(): string {
  const a = process.env.APEXPAY_PLATFORM_USER_ID?.trim();
  if (a !== undefined && a.length > 0) {
    return a;
  }
  const b = process.env.SAFE_TAXI_PLATFORM_USER_ID?.trim();
  if (b !== undefined && b.length > 0) {
    return b;
  }
  throw new RefundConfigurationError(
    "Ustaw APEXPAY_PLATFORM_USER_ID lub SAFE_TAXI_PLATFORM_USER_ID (portfel platformy do zwrotów).",
  );
}

function sumMapValues(m: Map<string, bigint>): bigint {
  let s = 0n;
  for (const v of m.values()) {
    s += v;
  }
  return s;
}

/**
 * Rozkłada kwotę zwrotu proporcjonalnie do składowych oryginalnego charge (P + Σ S_i = original).
 */
export function allocateRefundCostSplit(
  refundAmount: bigint,
  chargeOriginal: bigint,
  platformCents: bigint,
  connectedCredits: Map<string, bigint>,
): { platformDebit: bigint; perConnectedAccount: Map<string, bigint> } {
  const perConnectedAccount = new Map<string, bigint>();
  if (chargeOriginal === 0n || refundAmount === 0n) {
    return { platformDebit: 0n, perConnectedAccount };
  }

  const platformDebit = (refundAmount * platformCents) / chargeOriginal;
  const caIds = [...connectedCredits.keys()];
  let allocatedCa = 0n;

  for (let i = 0; i < caIds.length; i++) {
    const id = caIds[i]!;
    const s = connectedCredits.get(id)!;
    const part =
      i === caIds.length - 1
        ? refundAmount - platformDebit - allocatedCa
        : (refundAmount * s) / chargeOriginal;
    if (i !== caIds.length - 1) {
      allocatedCa += part;
    }
    perConnectedAccount.set(id, part);
  }

  return { platformDebit, perConnectedAccount };
}

/**
 * Zwrot pokrywany wyłącznie przez subkonta — udział (R * S_i) / splitSum.
 */
export function allocateRefundCostConnectedOnly(
  refundAmount: bigint,
  connectedCredits: Map<string, bigint>,
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const splitSum = sumMapValues(connectedCredits);
  if (splitSum === 0n || refundAmount === 0n) {
    return out;
  }
  const ids = [...connectedCredits.keys()];
  let allocated = 0n;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const s = connectedCredits.get(id)!;
    const part =
      i === ids.length - 1
        ? refundAmount - allocated
        : (refundAmount * s) / splitSum;
    if (i !== ids.length - 1) {
      allocated += part;
    }
    out.set(id, part);
  }
  return out;
}

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
export async function validateRefundEligibility(
  prisma: PrismaClient,
  input: ValidateRefundEligibilityInput,
): Promise<void> {
  const { charge, integratorUserId, refundAmount, coveredBy, composition } = input;

  if (charge.integratorUserId !== integratorUserId) {
    throw new RefundForbiddenError();
  }

  if (refundAmount <= 0n) {
    throw new RangeError("refundAmount musi być > 0.");
  }

  const maxMs = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (Date.now() - charge.createdAt.getTime() > maxMs) {
    throw new RefundWindowExpiredError();
  }

  const agg = await prisma.refund.aggregate({
    where: { chargeId: charge.id, status: RefundStatus.SUCCEEDED },
    _sum: { amount: true },
  });
  const alreadyRefunded = agg._sum.amount ?? 0n;

  if (alreadyRefunded >= charge.amountCents) {
    throw new ChargeAlreadyFullyRefundedError();
  }
  if (alreadyRefunded + refundAmount > charge.amountCents) {
    throw new RefundAmountExceededError();
  }

  const splitSum = sumMapValues(composition.connectedCredits);

  if (coveredBy === RefundCoveredBy.CONNECTED_ACCOUNT) {
    if (splitSum === 0n) {
      throw new RefundNoConnectedAccountsForCoverageError();
    }
    for (const caId of composition.connectedCredits.keys()) {
      const row = await prisma.connectedAccount.findUnique({
        where: { id: caId },
        select: { id: true },
      });
      if (row === null) {
        throw new RefundSplitAccountsMissingError();
      }
    }
  }

  if (coveredBy === RefundCoveredBy.SPLIT) {
    if (composition.platformCents === 0n && splitSum === 0n) {
      throw new RefundSplitAccountsMissingError();
    }
    for (const caId of composition.connectedCredits.keys()) {
      const row = await prisma.connectedAccount.findUnique({
        where: { id: caId },
        select: { id: true },
      });
      if (row === null) {
        throw new RefundSplitAccountsMissingError();
      }
    }
  }
}

export class RefundService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditLogService?: AuditLogService,
    private readonly webhookPublish?: (outboxId: string) => Promise<void>,
  ) {}

  async listForCharge(
    integratorUserId: string,
    chargeId: string,
  ): Promise<Refund[]> {
    const id = chargeId.trim();
    if (id.length === 0) {
      throw new RangeError("chargeId jest wymagane.");
    }

    const charge = await this.prisma.marketplaceCharge.findUnique({
      where: { id },
      select: { integratorUserId: true },
    });
    if (charge === null) {
      throw new RefundChargeNotFoundError();
    }
    if (charge.integratorUserId !== integratorUserId) {
      throw new RefundForbiddenError();
    }

    return this.prisma.refund.findMany({
      where: { chargeId: id },
      orderBy: { createdAt: "desc" },
    });
  }

  async createRefund(params: {
    redis: Redis;
    integratorUserId: string;
    chargeId: string;
    amount: bigint;
    coveredBy: RefundCoveredBy;
    reason?: string | undefined;
    idempotencyKey: string;
    initiatedBy: string;
    request?: Request | undefined;
  }): Promise<{ refund: Refund }> {
    const idem = params.idempotencyKey.trim();
    if (idem.length === 0) {
      throw new RangeError("Idempotency-Key jest wymagany.");
    }

    const redisKey = `${REFUND_IDEMP_REDIS_PREFIX}${idem}`;
    const setOk = await params.redis.set(redisKey, "1", "EX", 86_400, "NX");
    if (setOk !== "OK") {
      throw new IdempotencyConflictError();
    }

    const chargeId = params.chargeId.trim();
    if (chargeId.length === 0) {
      await params.redis.del(redisKey);
      throw new RangeError("chargeId jest wymagane.");
    }

    const startedAt = performance.now();
    try {
      contextLogger().info(
        {
          integratorUserId: params.integratorUserId,
          chargeId,
          amount: params.amount.toString(),
          coveredBy: params.coveredBy,
        },
        "Refund: create started",
      );

      const charge = await this.prisma.marketplaceCharge.findUnique({
        where: { id: chargeId },
      });
      if (charge === null) {
        throw new RefundChargeNotFoundError();
      }

      const composition = await loadChargeLedgerComposition(this.prisma, charge.id);

      await validateRefundEligibility(this.prisma, {
        charge,
        integratorUserId: params.integratorUserId,
        refundAmount: params.amount,
        coveredBy: params.coveredBy,
        composition,
      });

      const payerUserId = charge.debitUserId;
      const refundCurrency = charge.currency.trim().toUpperCase() || "PLN";

      const out = await this.prisma.$transaction(
        async (tx) => {
          const refundId = randomUUID();
          const platformUserId = getMarketplacePlatformUserId();

          const payerWallet = await tx.wallet.findUnique({
            where: { userId: payerUserId },
            select: { id: true },
          });
          if (payerWallet === null) {
            throw new WalletNotFoundError();
          }

          const platformWallet = await tx.wallet.findUnique({
            where: { userId: platformUserId },
            select: { id: true },
          });
          if (platformWallet === null) {
            throw new WalletNotFoundError();
          }

          const refundAmount = params.amount;
          const original = charge.amountCents;

          const applyDebit = async (
            walletId: string,
            amount: bigint,
            referenceId: string,
          ): Promise<void> => {
            if (amount === 0n) {
              return;
            }
            try {
              await tx.wallet.update({
                where: { id: walletId },
                data: { balance: { decrement: amount } },
              });
            } catch (err) {
              if (isInsufficientFundsDbError(err)) {
                throw new InsufficientFundsError();
              }
              throw err;
            }
            await tx.transaction.create({
              data: {
                walletId,
                amount: -amount,
                referenceId,
                type: TxType.REFUND_DEBIT,
              },
            });
          };

          const applyDebitAllowNegative = async (
            walletId: string,
            amount: bigint,
            referenceId: string,
          ): Promise<void> => {
            if (amount === 0n) {
              return;
            }
            await tx.wallet.update({
              where: { id: walletId },
              data: { balance: { decrement: amount } },
            });
            await tx.transaction.create({
              data: {
                walletId,
                amount: -amount,
                referenceId,
                type: TxType.REFUND_DEBIT,
              },
            });
          };

          if (params.coveredBy === RefundCoveredBy.PLATFORM) {
            await applyDebit(
              platformWallet.id,
              refundAmount,
              `ref:${refundId}:debit:platform`,
            );
          } else if (params.coveredBy === RefundCoveredBy.CONNECTED_ACCOUNT) {
            const perCa = allocateRefundCostConnectedOnly(
              refundAmount,
              composition.connectedCredits,
            );
            for (const [caId, cents] of perCa) {
              if (cents === 0n) {
                continue;
              }
              const ca = await tx.connectedAccount.findUnique({
                where: { id: caId },
                select: { userId: true },
              });
              if (ca === null || ca.userId === null) {
                throw new RefundSplitAccountsMissingError();
              }
              const w = await tx.wallet.findUnique({
                where: { userId: ca.userId },
                select: { id: true },
              });
              if (w === null) {
                throw new WalletNotFoundError();
              }
              await applyDebitAllowNegative(
                w.id,
                cents,
                `ref:${refundId}:debit:ca:${caId}`,
              );
            }
          } else {
            const { platformDebit, perConnectedAccount } = allocateRefundCostSplit(
              refundAmount,
              original,
              composition.platformCents,
              composition.connectedCredits,
            );

            if (platformDebit > 0n) {
              await applyDebit(
                platformWallet.id,
                platformDebit,
                `ref:${refundId}:debit:platform`,
              );
            }

            for (const [caId, cents] of perConnectedAccount) {
              if (cents === 0n) {
                continue;
              }
              const ca = await tx.connectedAccount.findUnique({
                where: { id: caId },
                select: { userId: true },
              });
              if (ca === null || ca.userId === null) {
                throw new RefundSplitAccountsMissingError();
              }
              const w = await tx.wallet.findUnique({
                where: { userId: ca.userId },
                select: { id: true },
              });
              if (w === null) {
                throw new WalletNotFoundError();
              }
              await applyDebitAllowNegative(
                w.id,
                cents,
                `ref:${refundId}:debit:ca:${caId}`,
              );
            }
          }

          await tx.wallet.update({
            where: { id: payerWallet.id },
            data: { balance: { increment: refundAmount } },
          });
          await tx.transaction.create({
            data: {
              walletId: payerWallet.id,
              amount: refundAmount,
              referenceId: `ref:${refundId}:credit`,
              type: TxType.REFUND_CREDIT,
            },
          });

          const refundRow = await tx.refund.create({
            data: {
              id: refundId,
              chargeId: charge.id,
              amount: refundAmount,
              currency: refundCurrency,
              status: RefundStatus.SUCCEEDED,
              coveredBy: params.coveredBy,
              reason: params.reason?.trim().slice(0, 255) || null,
              initiatedBy: params.initiatedBy,
              idempotencyKey: idem,
            },
          });

          if (this.auditLogService !== undefined) {
            await this.auditLogService.log(
              tx,
              {
                actorId: params.integratorUserId,
                actorType: AuditActorType.USER,
                action: AuditAction.CHARGE_REFUNDED,
                entityType: "MarketplaceCharge",
                entityId: charge.id,
                metadata: {
                  refundId,
                  amount: refundAmount.toString(),
                  currency: refundCurrency,
                  coveredBy: params.coveredBy,
                  reason: params.reason ?? null,
                },
              },
              params.request,
            );
          }

          const wo = await tx.webhookOutbox.create({
            data: {
              integratorUserId: params.integratorUserId,
              eventType: "charge.refunded",
              payload: {
                chargeId: charge.id,
                refundId,
                amount: refundAmount.toString(),
                currency: refundCurrency,
                coveredBy: params.coveredBy,
              },
            },
          });

          return { refund: refundRow, webhookOutboxId: wo.id };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 20000,
        },
      );

      if (this.webhookPublish !== undefined) {
        void this.webhookPublish(out.webhookOutboxId).catch((err: unknown) => {
          const m = err instanceof Error ? err.message : String(err);
          console.error("[WebhookPublish] refund:", m);
        });
      }

      contextLogger().info(
        {
          refundId: out.refund.id,
          chargeId: charge.id,
          durationMs: Math.round(performance.now() - startedAt),
        },
        "Refund: create succeeded",
      );

      return { refund: out.refund };
    } catch (err) {
      contextLogger().error(
        {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        },
        "Refund: create failed",
      );
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const target = err.meta?.target;
        if (Array.isArray(target) && target.includes("idempotencyKey")) {
          throw new IdempotencyConflictError();
        }
      }
      await params.redis.del(redisKey);
      throw err;
    }
  }
}
