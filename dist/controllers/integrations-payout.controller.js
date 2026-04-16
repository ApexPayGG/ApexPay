import { z, ZodError } from "zod";
import { ConnectedAccountInactiveError, ConnectedAccountIntegratorMismatchError, ConnectedAccountNotFoundError, IdempotencyConflictError, MarketplaceValidationError, } from "../services/marketplace-charge.service.js";
import { FraudBlockedError } from "../services/fraud-detection.service.js";
import { PayoutService } from "../services/payout.service.js";
import { InsufficientFundsError, WalletNotFoundError } from "../services/wallet.service.js";
import { decodeCursor, parsePaginationLimit } from "../lib/pagination.js";
const bodySchema = z
    .object({
    amount: z.number().int().positive(),
    connectedAccountId: z.string().trim().min(1).max(128),
})
    .strict();
function serializePayout(row) {
    return {
        id: row.id,
        connectedAccountId: row.connectedAccountId,
        amount: row.amount.toString(),
        currency: row.currency,
        status: row.status,
        pspReferenceId: row.pspReferenceId,
        fraudCheckId: row.fraudCheckId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}
function serializePayoutListItem(row) {
    return {
        id: row.id,
        amount: row.amount.toString(),
        currency: row.currency,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        connectedAccountId: row.connectedAccountId,
        connectedAccountEmail: row.connectedAccountEmail,
    };
}
export class IntegrationsPayoutController {
    payoutService;
    redis;
    constructor(payoutService, redis) {
        this.payoutService = payoutService;
        this.redis = redis;
    }
    async listPayouts(req, res) {
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
            const { items: rows, nextCursor } = await this.payoutService.listForIntegration(integratorUserId, cursorStr === undefined ? { limit } : { limit, cursor: cursorStr });
            const items = rows.map(serializePayoutListItem);
            res.status(200).json({ status: "success", data: { items, nextCursor } });
        }
        catch (err) {
            console.error("[integrations/payouts GET]", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
    async create(req, res) {
        const integratorUserId = req.user?.id?.trim();
        if (integratorUserId === undefined || integratorUserId.length === 0) {
            res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
            return;
        }
        const idemHeader = req.headers["idempotency-key"];
        const idempotencyKey = typeof idemHeader === "string" && idemHeader.trim().length > 0
            ? idemHeader.trim().slice(0, 256)
            : "";
        if (idempotencyKey.length === 0) {
            res.status(400).json({
                error: "Wymagany nagłówek Idempotency-Key.",
                code: "BAD_REQUEST",
            });
            return;
        }
        try {
            const body = bodySchema.parse(req.body);
            const { payout } = await this.payoutService.createPayout({
                redis: this.redis,
                integratorUserId,
                idempotencyKey,
                connectedAccountId: body.connectedAccountId,
                amount: BigInt(body.amount),
                request: req,
            });
            res.status(201).json({
                status: "success",
                data: serializePayout(payout),
            });
        }
        catch (err) {
            if (err instanceof ZodError) {
                res.status(400).json({ error: "Nieprawidłowe dane.", code: "BAD_REQUEST" });
                return;
            }
            if (err instanceof IdempotencyConflictError) {
                res.status(409).json({ error: err.message, code: "CONFLICT" });
                return;
            }
            if (err instanceof MarketplaceValidationError) {
                res.status(400).json({ error: err.message, code: "BAD_REQUEST" });
                return;
            }
            if (err instanceof ConnectedAccountNotFoundError) {
                res.status(404).json({ error: "Nie znaleziono subkonta.", code: "NOT_FOUND" });
                return;
            }
            if (err instanceof ConnectedAccountIntegratorMismatchError) {
                res.status(403).json({ error: err.message, code: "FORBIDDEN" });
                return;
            }
            if (err instanceof ConnectedAccountInactiveError) {
                res.status(403).json({ error: err.message, code: "FORBIDDEN" });
                return;
            }
            if (err instanceof InsufficientFundsError) {
                res.status(402).json({ error: "Niewystarczające środki.", code: "PAYMENT_REQUIRED" });
                return;
            }
            if (err instanceof FraudBlockedError) {
                res.status(422).json({
                    error: err.message,
                    code: "FRAUD_BLOCKED",
                    fraudCheckId: err.fraudCheckId,
                    score: err.score,
                });
                return;
            }
            if (err instanceof WalletNotFoundError) {
                res.status(404).json({ error: "Brak portfela.", code: "NOT_FOUND" });
                return;
            }
            console.error("[integrations/payouts]", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
}
//# sourceMappingURL=integrations-payout.controller.js.map