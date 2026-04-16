import { AuditAction } from "@prisma/client";
import { z, ZodError } from "zod";
import { MarketplaceValidationError } from "../services/marketplace-charge.service.js";
import { PayoutInvalidStateError, PayoutNotFoundError, PayoutService, } from "../services/payout.service.js";
import { WalletNotFoundError } from "../services/wallet.service.js";
const MAX_LIMIT = 100;
function isAuditAction(s) {
    return Object.values(AuditAction).includes(s);
}
function serializeAuditLog(row) {
    return {
        id: row.id,
        actorId: row.actorId,
        actorType: row.actorType,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        metadata: row.metadata,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        createdAt: row.createdAt.toISOString(),
    };
}
const settlePayoutBodySchema = z
    .object({
    status: z.enum(["PAID", "FAILED"]),
    pspReferenceId: z.string().trim().min(1).max(256).optional(),
})
    .strict();
export class AdminController {
    walletService;
    payoutService;
    auditLogService;
    constructor(walletService, payoutService, auditLogService) {
        this.walletService = walletService;
        this.payoutService = payoutService;
        this.auditLogService = auditLogService;
    }
    /** Dziennik audytu — filtry + kursor (createdAt desc). */
    async listAuditLogs(req, res) {
        try {
            const limitRaw = Number.parseInt(String(req.query.limit ?? "50"), 10);
            const limit = Number.isFinite(limitRaw)
                ? Math.min(MAX_LIMIT, Math.max(1, limitRaw))
                : 50;
            const actorIdRaw = req.query.actorId;
            const actorId = typeof actorIdRaw === "string" && actorIdRaw.trim().length > 0
                ? actorIdRaw.trim()
                : undefined;
            const entityTypeRaw = req.query.entityType;
            const entityType = typeof entityTypeRaw === "string" && entityTypeRaw.trim().length > 0
                ? entityTypeRaw.trim().slice(0, 128)
                : undefined;
            const entityIdRaw = req.query.entityId;
            const entityId = typeof entityIdRaw === "string" && entityIdRaw.trim().length > 0
                ? entityIdRaw.trim().slice(0, 128)
                : undefined;
            const actionRaw = req.query.action;
            let action;
            if (typeof actionRaw === "string" && actionRaw.trim().length > 0) {
                const t = actionRaw.trim();
                if (!isAuditAction(t)) {
                    res.status(400).json({
                        error: "Nieprawidłowa wartość action.",
                        code: "BAD_REQUEST",
                    });
                    return;
                }
                action = t;
            }
            let from;
            const fromRaw = req.query.from;
            if (typeof fromRaw === "string" && fromRaw.trim().length > 0) {
                const d = new Date(fromRaw.trim());
                if (Number.isNaN(d.getTime())) {
                    res.status(400).json({ error: "Nieprawidłowe from.", code: "BAD_REQUEST" });
                    return;
                }
                from = d;
            }
            let to;
            const toRaw = req.query.to;
            if (typeof toRaw === "string" && toRaw.trim().length > 0) {
                const d = new Date(toRaw.trim());
                if (Number.isNaN(d.getTime())) {
                    res.status(400).json({ error: "Nieprawidłowe to.", code: "BAD_REQUEST" });
                    return;
                }
                to = d;
            }
            const cursorRaw = req.query.cursor;
            const cursor = typeof cursorRaw === "string" && cursorRaw.trim().length > 0
                ? cursorRaw.trim()
                : undefined;
            const filters = {};
            if (actorId !== undefined) {
                filters.actorId = actorId;
            }
            if (entityType !== undefined) {
                filters.entityType = entityType;
            }
            if (entityId !== undefined) {
                filters.entityId = entityId;
            }
            if (action !== undefined) {
                filters.action = action;
            }
            if (from !== undefined) {
                filters.from = from;
            }
            if (to !== undefined) {
                filters.to = to;
            }
            const { items, nextCursor } = await this.auditLogService.listForAdmin(filters, limit, cursor);
            res.status(200).json({
                items: items.map(serializeAuditLog),
                nextCursor,
            });
        }
        catch (err) {
            console.error("Admin listAuditLogs:", err);
            res.status(500).json({
                error: "Błąd serwera przy pobieraniu audytu.",
                code: "INTERNAL_ERROR",
            });
        }
    }
    /** Lista transakcji (ledger) — paginacja `page` + `limit`. */
    async listTransactions(req, res) {
        try {
            const limitRaw = Number.parseInt(String(req.query.limit ?? "50"), 10);
            const pageRaw = Number.parseInt(String(req.query.page ?? "0"), 10);
            const limit = Number.isFinite(limitRaw)
                ? Math.min(MAX_LIMIT, Math.max(1, limitRaw))
                : 50;
            const page = Number.isFinite(pageRaw) && pageRaw >= 0 ? pageRaw : 0;
            const skip = page * limit;
            const prefixRaw = typeof req.query.referenceIdPrefix === "string"
                ? req.query.referenceIdPrefix
                : "";
            const referenceIdPrefix = prefixRaw.trim().length > 0 ? prefixRaw.trim().slice(0, 128) : undefined;
            const { items, total } = await this.walletService.listTransactionsAdmin(skip, limit, referenceIdPrefix !== undefined ? { referenceIdPrefix } : undefined);
            res.status(200).json({
                items,
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            });
        }
        catch (err) {
            console.error("Admin listTransactions:", err);
            res.status(500).json({
                error: "Błąd serwera przy pobieraniu listy transakcji.",
                code: "INTERNAL_ERROR",
            });
        }
    }
    /** Rozliczenie wypłaty B2B (PAID / FAILED ze zwrotem na portfel subkonta). */
    async settlePayout(req, res) {
        const payoutId = typeof req.params.id === "string" ? req.params.id.trim() : "";
        if (payoutId.length === 0) {
            res.status(400).json({ error: "Brak identyfikatora wypłaty.", code: "BAD_REQUEST" });
            return;
        }
        try {
            const body = settlePayoutBodySchema.parse(req.body);
            const adminUserId = req.user?.id?.trim();
            const payout = await this.payoutService.settlePayout(payoutId, body.status, body.pspReferenceId, {
                request: req,
                adminUserId: adminUserId !== undefined && adminUserId.length > 0 ? adminUserId : undefined,
            });
            res.status(200).json({
                status: "success",
                data: {
                    id: payout.id,
                    connectedAccountId: payout.connectedAccountId,
                    amount: payout.amount.toString(),
                    currency: payout.currency,
                    payoutStatus: payout.status,
                    pspReferenceId: payout.pspReferenceId,
                    createdAt: payout.createdAt,
                    updatedAt: payout.updatedAt,
                },
            });
        }
        catch (err) {
            if (err instanceof ZodError) {
                res.status(400).json({ error: "Nieprawidłowe dane.", code: "BAD_REQUEST" });
                return;
            }
            if (err instanceof PayoutNotFoundError) {
                res.status(404).json({ error: err.message, code: "NOT_FOUND" });
                return;
            }
            if (err instanceof PayoutInvalidStateError) {
                res.status(409).json({ error: err.message, code: "CONFLICT" });
                return;
            }
            if (err instanceof MarketplaceValidationError) {
                res.status(400).json({ error: err.message, code: "BAD_REQUEST" });
                return;
            }
            if (err instanceof WalletNotFoundError) {
                res.status(404).json({ error: err.message, code: "NOT_FOUND" });
                return;
            }
            console.error("Admin settlePayout:", err);
            res.status(500).json({
                error: "Błąd serwera przy rozliczaniu wypłaty.",
                code: "INTERNAL_ERROR",
            });
        }
    }
}
//# sourceMappingURL=admin.controller.js.map