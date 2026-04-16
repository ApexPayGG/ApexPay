import { ConnectedAccountSubjectType } from "@prisma/client";
import { z, ZodError } from "zod";
import { ConnectedAccountDuplicateError, ConnectedAccountService, } from "../services/connected-account.service.js";
import { decodeCursor, parsePaginationLimit } from "../lib/pagination.js";
const bodySchema = z
    .object({
    email: z.string().email().trim(),
    type: z.enum(["INDIVIDUAL", "COMPANY"]),
    country: z
        .string()
        .trim()
        .length(2)
        .transform((c) => c.toUpperCase()),
})
    .strict();
function serializeAccount(row) {
    return {
        id: row.id,
        integratorUserId: row.integratorUserId,
        userId: row.userId,
        email: row.email,
        subjectType: row.subjectType,
        country: row.country,
        status: row.status,
        kycReferenceId: row.kycReferenceId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}
/** Widok listy — bez `integratorUserId` / `userId` / `kycReferenceId`. */
function serializeAccountListItem(row) {
    return {
        id: row.id,
        email: row.email,
        type: row.subjectType,
        country: row.country,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
    };
}
export class IntegrationsAccountController {
    service;
    constructor(service) {
        this.service = service;
    }
    async list(req, res) {
        const integratorUserId = req.user?.id?.trim();
        if (integratorUserId === undefined || integratorUserId.length === 0) {
            res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
            return;
        }
        try {
            const limit = parsePaginationLimit(req.query["limit"]);
            const rawCursor = req.query["cursor"];
            const cursorStr = typeof rawCursor === "string" && rawCursor.trim().length > 0 ? rawCursor.trim() : undefined;
            if (cursorStr !== undefined && decodeCursor(cursorStr) === undefined) {
                res.status(400).json({ error: "Nieprawidłowy parametr cursor.", code: "BAD_REQUEST" });
                return;
            }
            const { items: rows, nextCursor } = await this.service.listForIntegration(integratorUserId, cursorStr === undefined ? { limit } : { limit, cursor: cursorStr });
            const items = rows.map(serializeAccountListItem);
            res.status(200).json({ status: "success", data: { items, nextCursor } });
        }
        catch (err) {
            console.error("[integrations/accounts GET]", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
    async create(req, res) {
        const integratorUserId = req.user?.id?.trim();
        if (integratorUserId === undefined || integratorUserId.length === 0) {
            res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
            return;
        }
        try {
            const body = bodySchema.parse(req.body);
            const subjectType = body.type === "INDIVIDUAL"
                ? ConnectedAccountSubjectType.INDIVIDUAL
                : ConnectedAccountSubjectType.COMPANY;
            const row = await this.service.createForIntegration(integratorUserId, {
                email: body.email,
                subjectType,
                country: body.country,
            }, req);
            res.status(201).json({ status: "success", data: serializeAccount(row) });
        }
        catch (err) {
            if (err instanceof ZodError) {
                res.status(400).json({ error: "Nieprawidłowe dane.", code: "BAD_REQUEST" });
                return;
            }
            if (err instanceof RangeError) {
                res.status(400).json({ error: err.message, code: "BAD_REQUEST" });
                return;
            }
            if (err instanceof ConnectedAccountDuplicateError) {
                res.status(409).json({ error: err.message, code: "CONFLICT" });
                return;
            }
            console.error("[integrations/accounts]", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
}
//# sourceMappingURL=integrations-account.controller.js.map