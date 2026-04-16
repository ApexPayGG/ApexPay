import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, AuditAction, AuditActorType, ConnectedAccountStatus, ConnectedAccountSubjectType, FraudCheckStatus, TransactionType as TxType, } from "@prisma/client";
import { contextLogger } from "../lib/logger.js";
import { isInsufficientFundsDbError } from "../lib/prisma-wallet-errors.js";
import { decodeCursor, paginatedResponse, parsePaginationLimit, } from "../lib/pagination.js";
import { FraudBlockedError } from "./fraud-detection.service.js";
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
export class MarketplaceValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "MarketplaceValidationError";
    }
}
export class ConnectedAccountNotFoundError extends Error {
    constructor() {
        super("Connected account not found");
        this.name = "ConnectedAccountNotFoundError";
    }
}
export class ConnectedAccountInactiveError extends Error {
    constructor() {
        super("Subkonto musi mieć status ACTIVE.");
        this.name = "ConnectedAccountInactiveError";
    }
}
export class ConnectedAccountIntegratorMismatchError extends Error {
    constructor() {
        super("Subkonto nie należy do tego integratora.");
        this.name = "ConnectedAccountIntegratorMismatchError";
    }
}
export class IdempotencyConflictError extends Error {
    constructor() {
        super("Idempotency-Key został już użyty.");
        this.name = "IdempotencyConflictError";
    }
}
export class PaymentMethodNotOwnedError extends Error {
    constructor() {
        super("Metoda płatności nie istnieje lub nie należy do integratora.");
        this.name = "PaymentMethodNotOwnedError";
    }
}
/** Prefiks Redis: `idemp:mkt-charge:{Idempotency-Key}` */
export const INTEGRATION_CHARGE_IDEMP_REDIS_PREFIX = "idemp:mkt-charge:";
/** Łączy powtórzone connectedAccountId; rzuca MarketplaceValidationError przy błędzie. */
export function mergeSplitLines(splits) {
    const merged = new Map();
    for (const s of splits) {
        const id = s.connectedAccountId.trim();
        if (id.length === 0) {
            throw new MarketplaceValidationError("connectedAccountId jest wymagane.");
        }
        if (s.amountCents <= 0n) {
            throw new MarketplaceValidationError("Każdy split musi mieć amountCents > 0.");
        }
        merged.set(id, (merged.get(id) ?? 0n) + s.amountCents);
    }
    return merged;
}
/** Split B2B: suma ≤ amount; pusta tablica = całość jako opłata platformy. */
export function mergeIntegrationSplitLines(splits) {
    if (splits.length === 0) {
        return new Map();
    }
    return mergeSplitLines(splits);
}
/** `referenceId`: `mkt:{chargeId}:credit:{connectedAccountId}` (pomija `platform`). */
function parseMarketplaceConnectedCreditRef(referenceId) {
    const marker = ":credit:";
    const i = referenceId.indexOf(marker);
    if (i === -1 || !referenceId.startsWith("mkt:")) {
        return null;
    }
    const chargeId = referenceId.slice(4, i);
    const tail = referenceId.slice(i + marker.length);
    if (tail === "platform" || tail.length === 0) {
        return null;
    }
    return { chargeId, connectedAccountId: tail };
}
async function loadConnectedAccountIdsByChargeId(prisma, chargeIds) {
    const map = new Map();
    if (chargeIds.length === 0) {
        return map;
    }
    const txs = await prisma.transaction.findMany({
        where: {
            type: TxType.MARKETPLACE_CONNECTED_CREDIT,
            OR: chargeIds.map((cid) => ({
                referenceId: { startsWith: `mkt:${cid}:credit:` },
            })),
        },
        select: { referenceId: true },
    });
    for (const { referenceId } of txs) {
        const parsed = parseMarketplaceConnectedCreditRef(referenceId);
        if (parsed === null) {
            continue;
        }
        const arr = map.get(parsed.chargeId) ?? [];
        if (!arr.includes(parsed.connectedAccountId)) {
            arr.push(parsed.connectedAccountId);
        }
        map.set(parsed.chargeId, arr);
    }
    return map;
}
/**
 * Sandbox / MVP: jeden debit z portfela płatnika → kredyty na subkonta (ACTIVE).
 * Idempotencja po opcjonalnym idempotencyKey (nagłówek lub body).
 */
export class MarketplaceChargeService {
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
     * Charge B2B (klucz API): debit portfela integratora o `amountCents`, split na subkonta,
     * reszta jako prowizja na portfel integratora. Idempotencja: Redis NX + unikalny klucz w DB.
     */
    async createIntegrationCharge(params) {
        const idem = params.idempotencyKey.trim();
        if (idem.length === 0) {
            throw new MarketplaceValidationError("Idempotency-Key jest wymagany.");
        }
        if (params.amountCents <= 0n) {
            throw new MarketplaceValidationError("amount musi być > 0.");
        }
        const redisKey = `${INTEGRATION_CHARGE_IDEMP_REDIS_PREFIX}${idem}`;
        const setOk = await params.redis.set(redisKey, "1", "EX", 86_400, "NX");
        if (setOk !== "OK") {
            throw new IdempotencyConflictError();
        }
        const startedAt = performance.now();
        contextLogger().info({
            integratorUserId: params.integratorUserId,
            amountCents: params.amountCents.toString(),
            currency: params.currency,
        }, "Marketplace charge: create started");
        const merged = mergeIntegrationSplitLines(params.splits);
        let splitSum = 0n;
        for (const v of merged.values()) {
            splitSum += v;
        }
        if (splitSum > params.amountCents) {
            await params.redis.del(redisKey);
            throw new MarketplaceValidationError(`Suma splits (${splitSum}) nie może przekraczać amount (${params.amountCents}).`);
        }
        const platformFeeCents = params.amountCents - splitSum;
        const paymentMethodIdTrimmed = params.paymentMethodId !== undefined && params.paymentMethodId.trim().length > 0
            ? params.paymentMethodId.trim()
            : undefined;
        const accountIds = [...merged.keys()];
        const idToUser = new Map();
        if (accountIds.length > 0) {
            const accounts = await this.prisma.connectedAccount.findMany({
                where: { id: { in: accountIds } },
                select: {
                    id: true,
                    userId: true,
                    status: true,
                    integratorUserId: true,
                },
            });
            if (accounts.length !== accountIds.length) {
                await params.redis.del(redisKey);
                throw new ConnectedAccountNotFoundError();
            }
            for (const a of accounts) {
                if (a.integratorUserId !== params.integratorUserId) {
                    await params.redis.del(redisKey);
                    throw new ConnectedAccountIntegratorMismatchError();
                }
                if (a.status !== ConnectedAccountStatus.ACTIVE) {
                    await params.redis.del(redisKey);
                    throw new ConnectedAccountInactiveError();
                }
                if (a.userId === null) {
                    await params.redis.del(redisKey);
                    throw new MarketplaceValidationError("Subkonto musi być powiązane z użytkownikiem (KYC / portfel), aby otrzymać split.");
                }
                idToUser.set(a.id, a.userId);
            }
        }
        let fraudEval;
        if (this.fraudDetectionService !== undefined) {
            fraudEval = await this.fraudDetectionService.evaluate({
                userId: params.integratorUserId,
                amount: params.amountCents,
                currency: params.currency,
                entityType: "MarketplaceCharge",
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
                    integratorUserId: params.integratorUserId,
                }, "Marketplace charge: fraud FLAGGED — proceeding");
            }
        }
        try {
            const txResult = await this.prisma.$transaction(async (tx) => {
                if (paymentMethodIdTrimmed !== undefined) {
                    const pm = await tx.paymentMethod.findFirst({
                        where: {
                            id: paymentMethodIdTrimmed,
                            userId: params.integratorUserId,
                        },
                        select: { id: true },
                    });
                    if (pm === null) {
                        throw new PaymentMethodNotOwnedError();
                    }
                }
                const integratorWallet = await tx.wallet.findUnique({
                    where: { userId: params.integratorUserId },
                    select: { id: true },
                });
                if (integratorWallet === null) {
                    throw new WalletNotFoundError();
                }
                try {
                    await tx.wallet.update({
                        where: { userId: params.integratorUserId },
                        data: { balance: { decrement: params.amountCents } },
                    });
                }
                catch (err) {
                    if (isInsufficientFundsDbError(err)) {
                        throw new InsufficientFundsError();
                    }
                    throw err;
                }
                const chargeId = randomUUID();
                const chargeRow = await tx.marketplaceCharge.create({
                    data: {
                        id: chargeId,
                        debitUserId: params.integratorUserId,
                        integratorUserId: params.integratorUserId,
                        amountCents: params.amountCents,
                        currency: params.currency.trim().toUpperCase() || "PLN",
                        idempotencyKey: idem,
                        ...(fraudEval !== undefined &&
                            fraudEval.status === FraudCheckStatus.FLAGGED
                            ? { fraudCheckId: fraudEval.fraudCheckId }
                            : {}),
                    },
                });
                if (fraudEval !== undefined) {
                    await tx.fraudCheck.update({
                        where: { id: fraudEval.fraudCheckId },
                        data: { entityId: chargeRow.id },
                    });
                }
                await tx.transaction.create({
                    data: {
                        walletId: integratorWallet.id,
                        amount: -params.amountCents,
                        referenceId: `mkt:${chargeRow.id}:debit`,
                        type: TxType.MARKETPLACE_PAYER_DEBIT,
                    },
                });
                for (const [accId, cents] of merged) {
                    const targetUserId = idToUser.get(accId);
                    if (targetUserId === undefined) {
                        throw new MarketplaceValidationError("Niespójność subkont.");
                    }
                    const tw = await tx.wallet.findUnique({
                        where: { userId: targetUserId },
                        select: { id: true },
                    });
                    if (tw === null) {
                        throw new WalletNotFoundError();
                    }
                    await tx.wallet.update({
                        where: { userId: targetUserId },
                        data: { balance: { increment: cents } },
                    });
                    await tx.transaction.create({
                        data: {
                            walletId: tw.id,
                            amount: cents,
                            referenceId: `mkt:${chargeRow.id}:credit:${accId}`,
                            type: TxType.MARKETPLACE_CONNECTED_CREDIT,
                        },
                    });
                }
                if (platformFeeCents > 0n) {
                    await tx.wallet.update({
                        where: { userId: params.integratorUserId },
                        data: { balance: { increment: platformFeeCents } },
                    });
                    await tx.transaction.create({
                        data: {
                            walletId: integratorWallet.id,
                            amount: platformFeeCents,
                            referenceId: `mkt:${chargeRow.id}:credit:platform`,
                            type: TxType.MARKETPLACE_CONNECTED_CREDIT,
                        },
                    });
                }
                const splitsPayload = [...merged.entries()].map(([connectedAccountId, amountCents]) => ({
                    connectedAccountId,
                    amount: amountCents.toString(),
                }));
                const wo = await tx.webhookOutbox.create({
                    data: {
                        integratorUserId: params.integratorUserId,
                        eventType: "charge.succeeded",
                        payload: {
                            id: chargeRow.id,
                            amount: chargeRow.amountCents.toString(),
                            currency: chargeRow.currency,
                            splits: splitsPayload,
                            status: "SUCCESS",
                        },
                    },
                });
                if (this.auditLogService !== undefined) {
                    await this.auditLogService.log(tx, {
                        actorId: params.integratorUserId,
                        actorType: AuditActorType.USER,
                        action: AuditAction.CHARGE_CREATED,
                        entityType: "MarketplaceCharge",
                        entityId: chargeRow.id,
                        metadata: {
                            amountCents: chargeRow.amountCents.toString(),
                            currency: chargeRow.currency,
                            idempotencyKey: idem,
                            platformFeeCents: platformFeeCents.toString(),
                            splits: splitsPayload,
                            ...(fraudEval !== undefined &&
                                fraudEval.status === FraudCheckStatus.FLAGGED
                                ? { fraudCheckId: fraudEval.fraudCheckId, fraudScore: fraudEval.score }
                                : {}),
                        },
                    }, params.request);
                }
                return { chargeRow, webhookOutboxId: wo.id };
            }, {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                maxWait: 5000,
                timeout: 15000,
            });
            if (this.webhookPublish !== undefined) {
                void this.webhookPublish(txResult.webhookOutboxId).catch((err) => {
                    const m = err instanceof Error ? err.message : String(err);
                    console.error("[WebhookPublish] integration charge:", m);
                });
            }
            contextLogger().info({
                chargeId: txResult.chargeRow.id,
                durationMs: Math.round(performance.now() - startedAt),
                ...(fraudEval !== undefined &&
                    fraudEval.status === FraudCheckStatus.FLAGGED
                    ? { fraudCheckId: fraudEval.fraudCheckId }
                    : {}),
            }, "Marketplace charge: create succeeded");
            return { charge: txResult.chargeRow };
        }
        catch (err) {
            contextLogger().error({
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
            }, "Marketplace charge: create failed");
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
    async createConnectedAccount(userId) {
        const w = await this.prisma.wallet.findUnique({
            where: { userId },
            select: { id: true },
        });
        if (w === null) {
            throw new WalletNotFoundError();
        }
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { email: true },
        });
        if (user === null) {
            throw new MarketplaceValidationError("Nie znaleziono użytkownika.");
        }
        const row = await this.prisma.connectedAccount.create({
            data: {
                integratorUserId: userId,
                userId,
                email: user.email,
                subjectType: ConnectedAccountSubjectType.INDIVIDUAL,
                country: "PL",
                status: ConnectedAccountStatus.PENDING,
            },
            select: { id: true },
        });
        return { id: row.id };
    }
    async setConnectedAccountStatus(accountId, status) {
        const n = await this.prisma.connectedAccount.updateMany({
            where: { id: accountId },
            data: { status },
        });
        if (n.count === 0) {
            throw new ConnectedAccountNotFoundError();
        }
    }
    async chargeSplit(params) {
        const { debitUserId, amountCents, splits } = params;
        const idem = params.idempotencyKey?.trim();
        if (amountCents <= 0n) {
            throw new MarketplaceValidationError("amountCents musi być > 0.");
        }
        if (splits.length === 0) {
            throw new MarketplaceValidationError("splits nie może być puste.");
        }
        const merged = mergeSplitLines(splits);
        let sum = 0n;
        for (const v of merged.values()) {
            sum += v;
        }
        if (sum !== amountCents) {
            throw new MarketplaceValidationError(`Suma splits (${sum}) musi równać się amountCents (${amountCents}).`);
        }
        if (idem !== undefined && idem.length > 0) {
            const existing = await this.prisma.marketplaceCharge.findUnique({
                where: { idempotencyKey: idem },
                select: { id: true },
            });
            if (existing !== null) {
                return { chargeId: existing.id, idempotent: true };
            }
        }
        const accountIds = [...merged.keys()];
        const accounts = await this.prisma.connectedAccount.findMany({
            where: { id: { in: accountIds } },
            select: { id: true, userId: true, status: true },
        });
        if (accounts.length !== accountIds.length) {
            throw new ConnectedAccountNotFoundError();
        }
        for (const a of accounts) {
            if (a.status !== ConnectedAccountStatus.ACTIVE) {
                throw new ConnectedAccountInactiveError();
            }
            if (a.userId === null) {
                throw new MarketplaceValidationError("Subkonto musi być powiązane z użytkownikiem (KYC / portfel), aby otrzymać split.");
            }
        }
        const idToUser = new Map(accounts.map((a) => [a.id, a.userId]));
        return this.prisma.$transaction(async (tx) => {
            if (idem !== undefined && idem.length > 0) {
                const dup = await tx.marketplaceCharge.findUnique({
                    where: { idempotencyKey: idem },
                    select: { id: true },
                });
                if (dup !== null) {
                    return { chargeId: dup.id, idempotent: true };
                }
            }
            const payerWallet = await tx.wallet.findUnique({
                where: { userId: debitUserId },
                select: { id: true },
            });
            if (payerWallet === null) {
                throw new WalletNotFoundError();
            }
            try {
                await tx.wallet.update({
                    where: { userId: debitUserId },
                    data: { balance: { decrement: amountCents } },
                });
            }
            catch (err) {
                if (isInsufficientFundsDbError(err)) {
                    throw new InsufficientFundsError();
                }
                throw err;
            }
            const chargeId = randomUUID();
            const chargeRow = await tx.marketplaceCharge.create({
                data: {
                    id: chargeId,
                    debitUserId,
                    integratorUserId: debitUserId,
                    amountCents,
                    currency: "PLN",
                    idempotencyKey: idem && idem.length > 0 ? idem : null,
                },
                select: { id: true },
            });
            await tx.transaction.create({
                data: {
                    walletId: payerWallet.id,
                    amount: -amountCents,
                    referenceId: `mkt:${chargeRow.id}:debit`,
                    type: TxType.MARKETPLACE_PAYER_DEBIT,
                },
            });
            for (const [accId, cents] of merged) {
                const targetUserId = idToUser.get(accId);
                if (targetUserId === undefined) {
                    throw new MarketplaceValidationError("Niespójność subkont.");
                }
                const tw = await tx.wallet.findUnique({
                    where: { userId: targetUserId },
                    select: { id: true },
                });
                if (tw === null) {
                    throw new WalletNotFoundError();
                }
                await tx.wallet.update({
                    where: { userId: targetUserId },
                    data: { balance: { increment: cents } },
                });
                await tx.transaction.create({
                    data: {
                        walletId: tw.id,
                        amount: cents,
                        referenceId: `mkt:${chargeRow.id}:credit:${accId}`,
                        type: TxType.MARKETPLACE_CONNECTED_CREDIT,
                    },
                });
            }
            return { chargeId: chargeRow.id, idempotent: false };
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5000,
            timeout: 15000,
        });
    }
    /**
     * Lista charge’ów integratora (B2B) z ID subkont z ledgera (`mkt:…:credit:`), malejąco po `createdAt`.
     */
    async listForIntegration(integratorUserId, opts) {
        const limit = parsePaginationLimit(opts?.limit);
        const cursorDate = decodeCursor(opts?.cursor);
        const rows = await this.prisma.marketplaceCharge.findMany({
            where: {
                integratorUserId,
                ...(cursorDate !== undefined ? { createdAt: { lt: cursorDate } } : {}),
            },
            orderBy: { createdAt: "desc" },
            take: limit + 1,
            select: {
                id: true,
                amountCents: true,
                currency: true,
                createdAt: true,
            },
        });
        const slice = paginatedResponse(rows, limit, (r) => r.createdAt);
        const ids = slice.items.map((r) => r.id);
        const byCharge = await loadConnectedAccountIdsByChargeId(this.prisma, ids);
        const items = slice.items.map((r) => ({
            id: r.id,
            amountCents: r.amountCents,
            currency: r.currency,
            createdAt: r.createdAt,
            connectedAccountIds: byCharge.get(r.id) ?? [],
        }));
        return { items, nextCursor: slice.nextCursor };
    }
}
//# sourceMappingURL=marketplace-charge.service.js.map