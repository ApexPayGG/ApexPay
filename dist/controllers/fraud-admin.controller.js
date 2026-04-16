import { FraudCheckStatus } from "@prisma/client";
import { z, ZodError } from "zod";
import { FraudCheckNotFoundError, FraudDetectionService, } from "../services/fraud-detection.service.js";
const MAX_LIMIT = 100;
const reviewBodySchema = z
    .object({
    decision: z.enum(["APPROVE", "CONFIRM_FRAUD"]),
})
    .strict();
function isFraudCheckStatus(s) {
    return Object.values(FraudCheckStatus).includes(s);
}
function serializeFraudCheck(row) {
    return {
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        userId: row.userId,
        score: row.score,
        status: row.status,
        rulesTriggered: row.rulesTriggered,
        metadata: row.metadata,
        reviewedBy: row.reviewedBy,
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
    };
}
export class FraudAdminController {
    fraudDetectionService;
    constructor(fraudDetectionService) {
        this.fraudDetectionService = fraudDetectionService;
    }
    async list(req, res) {
        try {
            const limitRaw = Number.parseInt(String(req.query.limit ?? "50"), 10);
            const limit = Number.isFinite(limitRaw)
                ? Math.min(MAX_LIMIT, Math.max(1, limitRaw))
                : 50;
            const statusRaw = req.query.status;
            let status;
            if (typeof statusRaw === "string" && statusRaw.trim().length > 0) {
                const t = statusRaw.trim();
                if (!isFraudCheckStatus(t)) {
                    res.status(400).json({
                        error: "Nieprawidłowy status.",
                        code: "BAD_REQUEST",
                    });
                    return;
                }
                status = t;
            }
            const userIdRaw = req.query.userId;
            const userId = typeof userIdRaw === "string" && userIdRaw.trim().length > 0
                ? userIdRaw.trim().slice(0, 128)
                : undefined;
            const entityTypeRaw = req.query.entityType;
            const entityType = typeof entityTypeRaw === "string" && entityTypeRaw.trim().length > 0
                ? entityTypeRaw.trim().slice(0, 128)
                : undefined;
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
            if (status !== undefined) {
                filters.status = status;
            }
            if (userId !== undefined) {
                filters.userId = userId;
            }
            if (entityType !== undefined) {
                filters.entityType = entityType;
            }
            if (from !== undefined) {
                filters.from = from;
            }
            if (to !== undefined) {
                filters.to = to;
            }
            const { items, nextCursor } = await this.fraudDetectionService.listForAdmin(filters, limit, cursor);
            res.status(200).json({
                status: "success",
                data: {
                    items: items.map(serializeFraudCheck),
                    nextCursor,
                },
            });
        }
        catch (err) {
            console.error("FraudAdmin list:", err);
            res.status(500).json({
                error: "Błąd serwera przy pobieraniu FraudCheck.",
                code: "INTERNAL_ERROR",
            });
        }
    }
    async getById(req, res) {
        const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
        if (id.length === 0) {
            res.status(400).json({ error: "Brak identyfikatora.", code: "BAD_REQUEST" });
            return;
        }
        try {
            const row = await this.fraudDetectionService.getById(id);
            if (row === null) {
                res.status(404).json({ error: "Nie znaleziono.", code: "NOT_FOUND" });
                return;
            }
            res.status(200).json({ status: "success", data: serializeFraudCheck(row) });
        }
        catch (err) {
            console.error("FraudAdmin getById:", err);
            res.status(500).json({
                error: "Błąd serwera.",
                code: "INTERNAL_ERROR",
            });
        }
    }
    async review(req, res) {
        const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
        if (id.length === 0) {
            res.status(400).json({ error: "Brak identyfikatora.", code: "BAD_REQUEST" });
            return;
        }
        const adminUserId = req.user?.id?.trim();
        if (adminUserId === undefined || adminUserId.length === 0) {
            res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
            return;
        }
        try {
            const body = reviewBodySchema.parse(req.body);
            const updated = await this.fraudDetectionService.reviewFraudCheck(id, adminUserId, body.decision);
            res.status(200).json({ status: "success", data: serializeFraudCheck(updated) });
        }
        catch (err) {
            if (err instanceof ZodError) {
                res.status(400).json({ error: "Nieprawidłowe dane.", code: "BAD_REQUEST" });
                return;
            }
            if (err instanceof FraudCheckNotFoundError) {
                res.status(404).json({ error: err.message, code: "NOT_FOUND" });
                return;
            }
            console.error("FraudAdmin review:", err);
            res.status(500).json({
                error: "Błąd serwera.",
                code: "INTERNAL_ERROR",
            });
        }
    }
}
//# sourceMappingURL=fraud-admin.controller.js.map