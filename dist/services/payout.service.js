import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, AuditAction, AuditActorType, ConnectedAccountStatus, FraudCheckStatus, PayoutStatus, TransactionType as TxType, } from "@prisma/client";
import { FraudBlockedError } from "./fraud-detection.service.js";
import { contextLogger } from "../lib/logger.js";
import { decodeCursor, paginatedResponse, parsePaginationLimit, } from "../lib/pagination.js";
import { isInsufficientFundsDbError } from "../lib/prisma-wallet-errors.js";
import { ConnectedAccountInactiveError, ConnectedAccountIntegratorMismatchError, ConnectedAccountNotFoundError, IdempotencyConflictError, MarketplaceValidationError, } from "./marketplace-charge.service.js";
import { InsufficientFundsError, WalletNotFoundError } from "./wallet.service.js";
function clientIpFromRequest(req) {
    if (req === undefined) {
        return undefined;
    }
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.trim().length > 0) {
        const first = xff.split(",")[0]?.trim();
        if (first !== undefined && first.length > 0) {
            return first.slice(0, 256);
        }
    }
    const rip = req.socket?.remoteAddress;
    if (typeof rip === "string" && rip.length > 0) {
        return rip.slice(0, 256);
    }
    return undefined;
}
function userAgentFromRequest(req) {
    if (req === undefined) {
        return undefined;
    }
    const ua = req.headers["user-agent"];
    if (typeof ua !== "string" || ua.length === 0) {
        return undefined;
    }
    return ua.slice(0, 2048);
}
/** Prefiks Redis: `idemp:payout:{Idempotency-Key}` */
export const PAYOUT_IDEMP_REDIS_PREFIX = "idemp:payout:";
export class PayoutNotFoundError extends Error {
    constructor() {
        super("Nie znaleziono wypłaty.");
        this.name = "PayoutNotFoundError";
    }
}
export class PayoutInvalidStateError extends Error {
    constructor() {
        super("Wypłata jest już rozliczona lub ma niedozwolony status.");
        this.name = "PayoutInvalidStateError";
    }
}
export class PayoutService {
    prisma;
    webhookPublish;
    auditLogService;
    fraudDetectionService;
    constructor(prisma, webhookPublish, auditLogService, fraudDetectionService) {
        this.prisma = prisma;
        this.webhookPublish = webhookPublish;
        this.auditLogService = auditLogService;
        this.fraudDetectionService = fraudDetectionService;
    }
    /**
     * Rozliczenie wypłaty przez admina / proces: PAID (sukces PSP) lub FAILED ze zwrotem na portfel subkonta.
     */
    async settlePayout(payoutId, outcome, pspReferenceId, audit) {
        const id = payoutId.trim();
        if (id.length === 0) {
            throw new MarketplaceValidationError("payoutId jest wymagane.");
        }
        const pspTrimmed = pspReferenceId !== undefined && pspReferenceId !== null
            ? pspReferenceId.trim()
            : undefined;
        const pspForDb = pspTrimmed === undefined
            ? undefined
            : pspTrimmed.length > 0
                ? pspTrimmed.slice(0, 256)
                : null;
        const settled = await this.prisma.$transaction(async (tx) => {
            const row = await tx.payout.findUnique({
                where: { id },
                include: {
                    connectedAccount: {
                        select: { integratorUserId: true, userId: true },
                    },
                },
            });
            if (row === null) {
                throw new PayoutNotFoundError();
            }
            if (row.status !== PayoutStatus.PENDING &&
                row.status !== PayoutStatus.IN_TRANSIT) {
                throw new PayoutInvalidStateError();
            }
            const integratorUserId = row.connectedAccount.integratorUserId;
            let webhookOutboxId;
            if (outcome === "PAID") {
                const n = await tx.payout.updateMany({
                    where: {
                        id: row.id,
                        status: { in: [PayoutStatus.PENDING, PayoutStatus.IN_TRANSIT] },
                    },
                    data: {
                        status: PayoutStatus.PAID,
                        ...(pspForDb !== undefined ? { pspReferenceId: pspForDb } : {}),
                    },
                });
                if (n.count !== 1) {
                    throw new PayoutInvalidStateError();
                }
                const wo = await tx.webhookOutbox.create({
                    data: {
                        integratorUserId,
                        eventType: "payout.paid",
                        payload: {
                            id: row.id,
                            amount: row.amount.toString(),
                            currency: row.currency,
                            connectedAccountId: row.connectedAccountId,
                            status: "PAID",
                            pspReferenceId: pspForDb ?? null,
                        },
                    },
                });
                webhookOutboxId = wo.id;
            }
            else {
                const userId = row.connectedAccount.userId;
                if (userId === null) {
                    throw new MarketplaceValidationError("Subkonto nie ma powiązanego portfela — nie można zwrócić środków.");
                }
                const wallet = await tx.wallet.findUnique({
                    where: { userId },
                    select: { id: true },
                });
                if (wallet === null) {
                    throw new WalletNotFoundError();
                }
                const n = await tx.payout.updateMany({
                    where: {
                        id: row.id,
                        status: { in: [PayoutStatus.PENDING, PayoutStatus.IN_TRANSIT] },
                    },
                    data: { status: PayoutStatus.FAILED },
                });
                if (n.count !== 1) {
                    throw new PayoutInvalidStateError();
                }
                await tx.wallet.update({
                    where: { id: wallet.id },
                    data: { balance: { increment: row.amount } },
                });
                await tx.transaction.create({
                    data: {
                        walletId: wallet.id,
                        amount: row.amount,
                        referenceId: `pout-void:${row.id}`,
                        type: TxType.PAYOUT_REVERSAL,
                    },
                });
                const wo = await tx.webhookOutbox.create({
                    data: {
                        integratorUserId,
                        eventType: "payout.failed",
                        payload: {
                            id: row.id,
                            amount: row.amount.toString(),
                            currency: row.currency,
                            connectedAccountId: row.connectedAccountId,
                            status: "FAILED",
                        },
                    },
                });
                webhookOutboxId = wo.id;
            }
            if (this.auditLogService !== undefined) {
                const adminId = audit?.adminUserId?.trim();
                await this.auditLogService.log(tx, {
                    actorId: adminId !== undefined && adminId.length > 0 ? adminId : null,
                    actorType: adminId !== undefined && adminId.length > 0
                        ? AuditActorType.ADMIN
                        : AuditActorType.SYSTEM,
                    action: outcome === "PAID"
                        ? AuditAction.PAYOUT_SETTLED
                        : AuditAction.PAYOUT_FAILED,
                    entityType: "Payout",
                    entityId: row.id,
                    metadata: {
                        outcome,
                        pspReferenceId: pspForDb ?? null,
                        previousStatus: row.status,
                    },
                }, audit?.request);
            }
            const updated = await tx.payout.findUniqueOrThrow({ where: { id: row.id } });
            return { payout: updated, webhookOutboxId };
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5000,
            timeout: 15000,
        });
        if (this.webhookPublish !== undefined) {
            void this.webhookPublish(settled.webhookOutboxId).catch((err) => {
                const m = err instanceof Error ? err.message : String(err);
                console.error("[WebhookPublish] payout settle:", m);
            });
        }
        return settled.payout;
    }
    async createPayout(params) {
        const idem = params.idempotencyKey.trim();
        if (idem.length === 0) {
            throw new MarketplaceValidationError("Idempotency-Key jest wymagany.");
        }
        if (params.amount <= 0n) {
            throw new MarketplaceValidationError("amount musi być > 0.");
        }
        const redisKey = `${PAYOUT_IDEMP_REDIS_PREFIX}${idem}`;
        const setOk = await params.redis.set(redisKey, "1", "EX", 86_400, "NX");
        if (setOk !== "OK") {
            throw new IdempotencyConflictError();
        }
        const startedAt = performance.now();
        contextLogger().info({
            integratorUserId: params.integratorUserId,
            amount: params.amount.toString(),
            currency: params.currency ?? "PLN",
            connectedAccountId: params.connectedAccountId.trim(),
        }, "Payout: create started");
        const connectedAccountId = params.connectedAccountId.trim();
        const account = await this.prisma.connectedAccount.findUnique({
            where: { id: connectedAccountId },
            select: {
                id: true,
                integratorUserId: true,
                status: true,
                userId: true,
            },
        });
        if (account === null) {
            await params.redis.del(redisKey);
            throw new ConnectedAccountNotFoundError();
        }
        if (account.integratorUserId !== params.integratorUserId) {
            await params.redis.del(redisKey);
            throw new ConnectedAccountIntegratorMismatchError();
        }
        if (account.status !== ConnectedAccountStatus.ACTIVE) {
            await params.redis.del(redisKey);
            throw new ConnectedAccountInactiveError();
        }
        if (account.userId === null) {
            await params.redis.del(redisKey);
            throw new MarketplaceValidationError("Subkonto musi być powiązane z użytkownikiem (portfel), aby zlecić wypłatę.");
        }
        const wallet = await this.prisma.wallet.findUnique({
            where: { userId: account.userId },
            select: { id: true, balance: true },
        });
        if (wallet === null) {
            await params.redis.del(redisKey);
            throw new WalletNotFoundError();
        }
        if (wallet.balance < params.amount) {
            await params.redis.del(redisKey);
            throw new InsufficientFundsError();
        }
        const currency = (params.currency !== undefined ? params.currency.trim() : "PLN").toUpperCase() ||
            "PLN";
        const payoutId = randomUUID();
        const subjectUserId = account.userId;
        let fraudEval;
        if (this.fraudDetectionService !== undefined) {
            fraudEval = await this.fraudDetectionService.evaluate({
                userId: subjectUserId,
                amount: params.amount,
                currency,
                entityType: "Payout",
                prisma: this.prisma,
                ipAddress: clientIpFromRequest(params.request),
                userAgent: userAgentFromRequest(params.request),
            });
            if (fraudEval.status === FraudCheckStatus.BLOCKED) {
                await params.redis.del(redisKey);
                throw new FraudBlockedError(fraudEval.fraudCheckId, fraudEval.score);
            }
            if (fraudEval.status === FraudCheckStatus.FLAGGED) {
                contextLogger().warn({
                    fraudCheckId: fraudEval.fraudCheckId,
                    score: fraudEval.score,
                    subjectUserId,
                    payoutPreviewId: payoutId,
                }, "Payout: fraud FLAGGED — proceeding");
            }
        }
        try {
            const created = await this.prisma.$transaction(async (tx) => {
                try {
                    await tx.wallet.update({
                        where: { userId: subjectUserId },
                        data: { balance: { decrement: params.amount } },
                    });
                }
                catch (err) {
                    if (isInsufficientFundsDbError(err)) {
                        throw new InsufficientFundsError();
                    }
                    throw err;
                }
                await tx.transaction.create({
                    data: {
                        walletId: wallet.id,
                        amount: -params.amount,
                        referenceId: `pout:${payoutId}`,
                        type: TxType.PAYOUT_DEBIT,
                    },
                });
                const row = await tx.payout.create({
                    data: {
                        id: payoutId,
                        connectedAccountId: account.id,
                        amount: params.amount,
                        currency,
                        ...(fraudEval !== undefined &&
                            fraudEval.status === FraudCheckStatus.FLAGGED
                            ? { fraudCheckId: fraudEval.fraudCheckId }
                            : {}),
                    },
                });
                if (fraudEval !== undefined) {
                    await tx.fraudCheck.update({
                        where: { id: fraudEval.fraudCheckId },
                        data: { entityId: row.id },
                    });
                }
                const wo = await tx.webhookOutbox.create({
                    data: {
                        integratorUserId: params.integratorUserId,
                        eventType: "payout.created",
                        payload: {
                            id: payoutId,
                            amount: params.amount.toString(),
                            currency,
                            connectedAccountId: account.id,
                        },
                    },
                });
                if (this.auditLogService !== undefined) {
                    await this.auditLogService.log(tx, {
                        actorId: params.integratorUserId,
                        actorType: AuditActorType.USER,
                        action: AuditAction.PAYOUT_CREATED,
                        entityType: "Payout",
                        entityId: payoutId,
                        metadata: {
                            amount: params.amount.toString(),
                            currency,
                            connectedAccountId: account.id,
                            ...(fraudEval !== undefined &&
                                fraudEval.status === FraudCheckStatus.FLAGGED
                                ? { fraudCheckId: fraudEval.fraudCheckId, fraudScore: fraudEval.score }
                                : {}),
                        },
                    }, params.request);
                }
                return { row, webhookOutboxId: wo.id };
            }, {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                maxWait: 5000,
                timeout: 15000,
            });
            if (this.webhookPublish !== undefined) {
                void this.webhookPublish(created.webhookOutboxId).catch((err) => {
                    const m = err instanceof Error ? err.message : String(err);
                    console.error("[WebhookPublish] payout create:", m);
                });
            }
            contextLogger().info({
                payoutId: created.row.id,
                durationMs: Math.round(performance.now() - startedAt),
            }, "Payout: create succeeded");
            return { payout: created.row };
        }
        catch (err) {
            contextLogger().error({
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
            }, "Payout: create failed");
            await params.redis.del(redisKey);
            throw err;
        }
    }
    /**
     * Wypłaty powiązane z subkontami integratora, malejąco po `createdAt`.
     */
    async listForIntegration(integratorUserId, opts) {
        const limit = parsePaginationLimit(opts?.limit);
        const cursorDate = decodeCursor(opts?.cursor);
        const rows = await this.prisma.payout.findMany({
            where: {
                connectedAccount: { integratorUserId },
                ...(cursorDate !== undefined ? { createdAt: { lt: cursorDate } } : {}),
            },
            orderBy: { createdAt: "desc" },
            take: limit + 1,
            include: {
                connectedAccount: { select: { id: true, email: true } },
            },
        });
        const slice = paginatedResponse(rows, limit, (r) => r.createdAt);
        const items = slice.items.map((r) => ({
            id: r.id,
            amount: r.amount,
            currency: r.currency,
            status: r.status,
            createdAt: r.createdAt,
            connectedAccountId: r.connectedAccount.id,
            connectedAccountEmail: r.connectedAccount.email,
        }));
        return { items, nextCursor: slice.nextCursor };
    }
}
//# sourceMappingURL=payout.service.js.map