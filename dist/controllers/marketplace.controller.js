import { ConnectedAccountStatus } from "@prisma/client";
import { ConnectedAccountInactiveError, ConnectedAccountNotFoundError, MarketplaceChargeService, MarketplaceValidationError, } from "../services/marketplace-charge.service.js";
import { InsufficientFundsError, WalletNotFoundError } from "../services/wallet.service.js";
function parseBigintField(v, name) {
    const s = typeof v === "string"
        ? v.trim()
        : typeof v === "number"
            ? String(Math.trunc(v))
            : "";
    if (s.length === 0 || !/^\d+$/.test(s)) {
        throw new MarketplaceValidationError(`Pole ${name}: oczekiwana nieujemna liczba całkowita (string cyfr).`);
    }
    return BigInt(s);
}
export class MarketplaceController {
    service;
    constructor(service) {
        this.service = service;
    }
    async createConnectedAccount(req, res) {
        try {
            const body = req.body;
            const userId = typeof body.userId === "string" ? body.userId.trim() : "";
            if (userId.length === 0) {
                res.status(400).json({ error: "Wymagane pole: userId." });
                return;
            }
            const out = await this.service.createConnectedAccount(userId);
            res.status(201).json({ status: "success", data: { connectedAccountId: out.id } });
        }
        catch (err) {
            if (err instanceof WalletNotFoundError) {
                res.status(404).json({ error: "Użytkownik nie ma portfela." });
                return;
            }
            console.error("[marketplace] createConnectedAccount:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
    async patchConnectedAccount(req, res) {
        try {
            const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
            if (id.length === 0) {
                res.status(400).json({ error: "Brak ID subkonta." });
                return;
            }
            const body = req.body;
            const st = typeof body.status === "string" ? body.status.trim().toUpperCase() : "";
            const allowed = [
                ConnectedAccountStatus.PENDING,
                ConnectedAccountStatus.ACTIVE,
                ConnectedAccountStatus.RESTRICTED,
                ConnectedAccountStatus.REJECTED,
            ];
            const match = allowed.find((x) => x === st);
            if (match === undefined) {
                res.status(400).json({
                    error: "status musi być: PENDING | ACTIVE | RESTRICTED | REJECTED",
                });
                return;
            }
            await this.service.setConnectedAccountStatus(id, match);
            res.status(200).json({ status: "success" });
        }
        catch (err) {
            if (err instanceof ConnectedAccountNotFoundError) {
                res.status(404).json({ error: "Subkonto nie istnieje." });
                return;
            }
            console.error("[marketplace] patchConnectedAccount:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
    async createCharge(req, res) {
        try {
            const body = req.body;
            const debitUserId = typeof body.debitUserId === "string" ? body.debitUserId.trim() : "";
            if (debitUserId.length === 0) {
                res.status(400).json({ error: "Wymagane pole: debitUserId." });
                return;
            }
            let amountCents;
            try {
                amountCents = parseBigintField(body.amountCents, "amountCents");
            }
            catch (e) {
                res.status(400).json({ error: e instanceof Error ? e.message : "amountCents" });
                return;
            }
            if (!Array.isArray(body.splits) || body.splits.length === 0) {
                res.status(400).json({ error: "Wymagane pole: splits (niepusta tablica)." });
                return;
            }
            const splits = [];
            for (const row of body.splits) {
                if (typeof row !== "object" || row === null) {
                    res.status(400).json({ error: "Każdy element splits musi być obiektem." });
                    return;
                }
                const r = row;
                const cid = typeof r.connectedAccountId === "string" ? r.connectedAccountId.trim() : "";
                if (cid.length === 0) {
                    res.status(400).json({ error: "splits[].connectedAccountId jest wymagane." });
                    return;
                }
                let ac;
                try {
                    ac = parseBigintField(r.amountCents, "splits[].amountCents");
                }
                catch (e) {
                    res.status(400).json({ error: e instanceof Error ? e.message : "split amount" });
                    return;
                }
                splits.push({ connectedAccountId: cid, amountCents: ac });
            }
            const idemHeader = req.headers["idempotency-key"];
            const idempotencyKey = typeof idemHeader === "string" && idemHeader.trim().length > 0
                ? idemHeader.trim()
                : undefined;
            const result = await this.service.chargeSplit({
                debitUserId,
                amountCents,
                splits,
                idempotencyKey,
            });
            res.status(result.idempotent ? 200 : 201).json({
                status: "success",
                data: {
                    chargeId: result.chargeId,
                    idempotent: result.idempotent,
                },
            });
        }
        catch (err) {
            if (err instanceof MarketplaceValidationError) {
                res.status(400).json({ error: err.message });
                return;
            }
            if (err instanceof ConnectedAccountNotFoundError) {
                res.status(404).json({ error: "Nie znaleziono subkonta (connectedAccountId)." });
                return;
            }
            if (err instanceof ConnectedAccountInactiveError) {
                res.status(403).json({ error: err.message, code: "FORBIDDEN" });
                return;
            }
            if (err instanceof InsufficientFundsError) {
                res.status(402).json({ error: "Niewystarczające środki u płatnika." });
                return;
            }
            if (err instanceof WalletNotFoundError) {
                res.status(404).json({ error: "Brak portfela (płatnik lub odbiorca)." });
                return;
            }
            console.error("[marketplace] createCharge:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
}
//# sourceMappingURL=marketplace.controller.js.map