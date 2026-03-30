import { createHmac, timingSafeEqual } from "node:crypto";
const HEX64 = /^[0-9a-f]{64}$/;
/**
 * Weryfikuje HMAC-SHA256(payload) z nagłówka (64 znaki hex), porównanie stałoczasowe.
 */
export function verifyPspWebhookHmacSha256Hex(rawBody, signatureHeader, secret) {
    if (secret.length === 0 || signatureHeader === undefined) {
        return false;
    }
    const trimmed = signatureHeader.trim().toLowerCase();
    if (!HEX64.test(trimmed)) {
        return false;
    }
    const digest = createHmac("sha256", secret).update(rawBody).digest();
    const sigBuf = Buffer.from(trimmed, "hex");
    if (sigBuf.length !== digest.length) {
        return false;
    }
    return timingSafeEqual(digest, sigBuf);
}
//# sourceMappingURL=psp-webhook-hmac.js.map