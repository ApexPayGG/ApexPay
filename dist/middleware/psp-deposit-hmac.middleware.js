import { verifyPspWebhookHmacSha256Hex } from "../services/psp-webhook-hmac.js";
export const PSP_DEPOSIT_SIGNATURE_HEADER = "x-apexpay-signature";
/**
 * Weryfikacja HMAC surowego body (PSP_DEPOSIT_WEBHOOK_SECRET).
 * Musi być zarejestrowana **po** `express.json({ verify: rawBody })`.
 */
export function createPspDepositWebhookHmacMiddleware(getSecret) {
    return (req, res, next) => {
        const secret = getSecret();
        if (secret === undefined || secret.length === 0) {
            res.status(503).json({ error: "Webhook not configured" });
            return;
        }
        const raw = req.rawBody;
        if (raw === undefined || raw.length === 0) {
            res.status(400).json({ error: "Bad Request" });
            return;
        }
        const sig = req.get(PSP_DEPOSIT_SIGNATURE_HEADER);
        if (!verifyPspWebhookHmacSha256Hex(raw, sig ?? undefined, secret)) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        next();
    };
}
//# sourceMappingURL=psp-deposit-hmac.middleware.js.map