import { createHash, timingSafeEqual } from "node:crypto";
function getRequiredEnv(name) {
    const raw = process.env[name]?.trim();
    if (raw === undefined || raw.length === 0) {
        throw new Error(`${name} is required`);
    }
    return raw;
}
export function getAutopayConfig() {
    return {
        serviceId: getRequiredEnv("AUTOPAY_SERVICE_ID"),
        sharedKey: getRequiredEnv("AUTOPAY_SHARED_KEY"),
        gatewayUrl: getRequiredEnv("AUTOPAY_GATEWAY_URL"),
        returnUrl: getRequiredEnv("AUTOPAY_RETURN_URL"),
        itnUrl: getRequiredEnv("AUTOPAY_ITN_URL"),
    };
}
/**
 * Autopay BM: hash SHA-256 z `field1|field2|...|SHARED_KEY` (hex lowercase).
 */
export function generateHash(fields) {
    const sharedKey = getRequiredEnv("AUTOPAY_SHARED_KEY");
    const base = [...fields.map((f) => f.trim()), sharedKey].join("|");
    return createHash("sha256").update(base, "utf8").digest("hex");
}
export function verifyHash(fields, receivedHash) {
    const candidate = generateHash(fields);
    const left = Buffer.from(candidate, "hex");
    const rightRaw = receivedHash.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(rightRaw)) {
        return false;
    }
    const right = Buffer.from(rightRaw, "hex");
    if (left.length !== right.length) {
        return false;
    }
    return timingSafeEqual(left, right);
}
//# sourceMappingURL=autopay.js.map