import { AuditAction, AuditActorType, FraudCheckStatus, } from "@prisma/client";
import { ALL_FRAUD_RULES } from "../lib/fraud-rules.js";
function envInt(name, fallback) {
    const v = process.env[name]?.trim();
    if (v === undefined || v.length === 0) {
        return fallback;
    }
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
}
export class FraudBlockedError extends Error {
    fraudCheckId;
    score;
    constructor(fraudCheckId, score, message = "Operacja zablokowana ze względów bezpieczeństwa (fraud).") {
        super(message);
        this.fraudCheckId = fraudCheckId;
        this.score = score;
        this.name = "FraudBlockedError";
    }
}
export class FraudCheckNotFoundError extends Error {
    constructor() {
        super("FraudCheck nie znaleziony.");
        this.name = "FraudCheckNotFoundError";
    }
}
export class FraudDetectionService {
    prisma;
    auditLogService;
    constructor(prisma, auditLogService) {
        this.prisma = prisma;
        this.auditLogService = auditLogService;
    }
    /**
     * Ocena reguł (równolegle), scoring 0–100, zapis `FraudCheck` (osobna transakcja — niezależna od charge/payout).
     */
    async evaluate(context) {
        const readPrisma = context.prisma;
        const ruleCtx = { ...context, prisma: readPrisma };
        const raw = await Promise.all(ALL_FRAUD_RULES.map((rule) => rule(ruleCtx)));
        const triggered = raw.filter((x) => x !== null);
        let score = 0;
        for (const t of triggered) {
            score += t.score;
        }
        if (score > 100) {
            score = 100;
        }
        const flagTh = envInt("FRAUD_SCORE_FLAG_THRESHOLD", 30);
        const blockTh = envInt("FRAUD_SCORE_BLOCK_THRESHOLD", 70);
        let status;
        if (score < flagTh) {
            status = FraudCheckStatus.PASSED;
        }
        else if (score < blockTh) {
            status = FraudCheckStatus.FLAGGED;
        }
        else {
            status = FraudCheckStatus.BLOCKED;
        }
        const rulesJson = triggered.map((t) => ({
            rule: t.rule,
            score: t.score,
            detail: t.detail,
        }));
        const metadata = {
            currency: context.currency,
            amount: context.amount.toString(),
            ...(context.ipAddress !== undefined ? { ip: context.ipAddress } : {}),
            ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
        };
        const row = await this.prisma.$transaction(async (trx) => {
            const fc = await trx.fraudCheck.create({
                data: {
                    entityType: context.entityType,
                    entityId: null,
                    userId: context.userId,
                    score,
                    status,
                    rulesTriggered: rulesJson,
                    metadata,
                },
            });
            if (status !== FraudCheckStatus.PASSED &&
                this.auditLogService !== undefined) {
                await this.auditLogService.log(trx, {
                    actorType: AuditActorType.SYSTEM,
                    action: status === FraudCheckStatus.BLOCKED
                        ? AuditAction.FRAUD_BLOCKED
                        : AuditAction.FRAUD_FLAGGED,
                    entityType: "FraudCheck",
                    entityId: fc.id,
                    metadata: {
                        userId: context.userId,
                        entityType: context.entityType,
                        score,
                        rules: triggered.map((t) => t.rule),
                    },
                }, undefined);
            }
            return fc;
        });
        return {
            status,
            score,
            rulesTriggered: triggered.map((t) => ({
                rule: t.rule,
                score: t.score,
                detail: t.detail,
            })),
            fraudCheckId: row.id,
        };
    }
    async reviewFraudCheck(fraudCheckId, adminUserId, decision) {
        const existing = await this.prisma.fraudCheck.findUnique({
            where: { id: fraudCheckId },
        });
        if (existing === null) {
            throw new FraudCheckNotFoundError();
        }
        return this.prisma.$transaction(async (trx) => {
            const updated = await trx.fraudCheck.update({
                where: { id: fraudCheckId },
                data: {
                    reviewedBy: adminUserId,
                    reviewedAt: new Date(),
                },
            });
            if (this.auditLogService !== undefined) {
                await this.auditLogService.log(trx, {
                    actorId: adminUserId,
                    actorType: AuditActorType.ADMIN,
                    action: AuditAction.FRAUD_REVIEWED,
                    entityType: "FraudCheck",
                    entityId: fraudCheckId,
                    metadata: { decision },
                }, undefined);
            }
            return updated;
        });
    }
    async listForAdmin(filters, limit, cursorEncoded) {
        const take = Math.min(100, Math.max(1, limit));
        let cursor;
        if (cursorEncoded !== undefined && cursorEncoded.trim().length > 0) {
            try {
                const raw = Buffer.from(cursorEncoded.trim(), "base64url").toString("utf8");
                const parsed = JSON.parse(raw);
                if (typeof parsed.createdAt === "string" &&
                    typeof parsed.id === "string" &&
                    parsed.id.length > 0) {
                    cursor = { createdAt: parsed.createdAt, id: parsed.id };
                }
            }
            catch {
                cursor = undefined;
            }
        }
        const parts = [];
        if (filters.status !== undefined) {
            parts.push({ status: filters.status });
        }
        if (filters.userId !== undefined && filters.userId.length > 0) {
            parts.push({ userId: filters.userId });
        }
        if (filters.entityType !== undefined && filters.entityType.length > 0) {
            parts.push({ entityType: filters.entityType });
        }
        if (filters.from !== undefined || filters.to !== undefined) {
            const createdAt = {};
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
        const where = parts.length > 0 ? { AND: parts } : {};
        const rows = await this.prisma.fraudCheck.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: take + 1,
        });
        const hasMore = rows.length > take;
        const slice = hasMore ? rows.slice(0, take) : rows;
        let nextCursor = null;
        if (hasMore && slice.length > 0) {
            const last = slice[slice.length - 1];
            nextCursor = Buffer.from(JSON.stringify({
                createdAt: last.createdAt.toISOString(),
                id: last.id,
            }), "utf8").toString("base64url");
        }
        return { items: slice, nextCursor };
    }
    async getById(id) {
        return this.prisma.fraudCheck.findUnique({ where: { id } });
    }
    /** FLAGGED, utworzone w ostatniej godzinie, bez przeglądu — monitoring. */
    async countUnreviewedFlaggedRecent(hoursBack) {
        const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
        return this.prisma.fraudCheck.count({
            where: {
                status: FraudCheckStatus.FLAGGED,
                reviewedAt: null,
                createdAt: { gte: since },
            },
        });
    }
}
//# sourceMappingURL=fraud-detection.service.js.map