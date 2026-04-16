import { decodeCursor, parsePaginationLimit } from "../lib/pagination.js";
import { WebhookDeadLetterAlreadyRequeuedError, WebhookDeadLetterNotFoundError, WebhookDeadLetterService, } from "../services/webhook-dead-letter.service.js";
function parseRequeuedFilter(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === "") {
        return undefined;
    }
    const s = String(raw).toLowerCase().trim();
    if (s === "true") {
        return true;
    }
    if (s === "false") {
        return false;
    }
    return undefined;
}
function serializeDeadLetter(row) {
    return {
        id: row.id,
        integratorUserId: row.integratorUserId,
        eventType: row.eventType,
        payload: row.payload,
        attempts: row.attempts,
        lastError: row.lastError,
        lastAttemptAt: row.lastAttemptAt.toISOString(),
        originalOutboxId: row.originalOutboxId,
        requeued: row.requeued,
        requeuedAt: row.requeuedAt?.toISOString() ?? null,
        requeuedBy: row.requeuedBy,
        createdAt: row.createdAt.toISOString(),
    };
}
export class WebhookDeadLetterAdminController {
    service;
    constructor(service) {
        this.service = service;
    }
    async list(req, res) {
        try {
            const limit = parsePaginationLimit(req.query["limit"]);
            const rawCursor = req.query["cursor"];
            const cursorStr = typeof rawCursor === "string" && rawCursor.trim().length > 0 ? rawCursor.trim() : undefined;
            if (cursorStr !== undefined && decodeCursor(cursorStr) === undefined) {
                res.status(400).json({ error: "Nieprawidłowy parametr cursor.", code: "BAD_REQUEST" });
                return;
            }
            const integratorRaw = req.query["integratorUserId"];
            const integratorUserId = typeof integratorRaw === "string" && integratorRaw.trim().length > 0
                ? integratorRaw.trim()
                : undefined;
            const requeuedRaw = req.query["requeued"];
            let requeued;
            if (requeuedRaw !== undefined && String(requeuedRaw).trim() !== "") {
                const p = parseRequeuedFilter(requeuedRaw);
                if (p === undefined) {
                    res.status(400).json({ error: "Nieprawidłowy parametr requeued.", code: "BAD_REQUEST" });
                    return;
                }
                requeued = p;
            }
            let from;
            const fromRaw = req.query["from"];
            if (typeof fromRaw === "string" && fromRaw.trim().length > 0) {
                const d = new Date(fromRaw.trim());
                if (Number.isNaN(d.getTime())) {
                    res.status(400).json({ error: "Nieprawidłowe from.", code: "BAD_REQUEST" });
                    return;
                }
                from = d;
            }
            let to;
            const toRaw = req.query["to"];
            if (typeof toRaw === "string" && toRaw.trim().length > 0) {
                const d = new Date(toRaw.trim());
                if (Number.isNaN(d.getTime())) {
                    res.status(400).json({ error: "Nieprawidłowe to.", code: "BAD_REQUEST" });
                    return;
                }
                to = d;
            }
            const { items, nextCursor } = await this.service.listForAdmin({
                limit,
                ...(cursorStr !== undefined ? { cursor: cursorStr } : {}),
                ...(integratorUserId !== undefined ? { integratorUserId } : {}),
                ...(requeued !== undefined ? { requeued } : {}),
                ...(from !== undefined ? { from } : {}),
                ...(to !== undefined ? { to } : {}),
            });
            res.status(200).json({
                status: "success",
                data: {
                    items: items.map(serializeDeadLetter),
                    nextCursor,
                },
            });
        }
        catch (err) {
            console.error("[admin/webhook-dead-letters GET]", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
    async requeue(req, res) {
        const adminUserId = req.user?.id?.trim();
        if (adminUserId === undefined || adminUserId.length === 0) {
            res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
            return;
        }
        const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
        if (id.length === 0) {
            res.status(400).json({ error: "Brak identyfikatora.", code: "BAD_REQUEST" });
            return;
        }
        try {
            const { outboxId } = await this.service.requeueById(id, adminUserId, req);
            res.status(200).json({ status: "success", data: { outboxId } });
        }
        catch (err) {
            if (err instanceof WebhookDeadLetterNotFoundError) {
                res.status(404).json({ error: err.message, code: "NOT_FOUND" });
                return;
            }
            if (err instanceof WebhookDeadLetterAlreadyRequeuedError) {
                res.status(409).json({ error: err.message, code: "CONFLICT" });
                return;
            }
            if (err instanceof RangeError) {
                res.status(400).json({ error: err.message, code: "BAD_REQUEST" });
                return;
            }
            console.error("[admin/webhook-dead-letters requeue]", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
}
//# sourceMappingURL=webhook-dead-letter-admin.controller.js.map