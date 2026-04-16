import { createHash, timingSafeEqual } from "node:crypto";

export type AutopayConfig = {
  serviceId: string;
  sharedKey: string;
  gatewayUrl: string;
  returnUrl: string;
  itnUrl: string;
};

function getRequiredEnv(name: string): string {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) {
    throw new Error(`${name} is required`);
  }
  return raw;
}

export function getAutopayConfig(): AutopayConfig {
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
export function generateHash(fields: string[]): string {
  const sharedKey = getRequiredEnv("AUTOPAY_SHARED_KEY");
  const base = [...fields.map((f) => f.trim()), sharedKey].join("|");
  return createHash("sha256").update(base, "utf8").digest("hex");
}

export function verifyHash(fields: string[], receivedHash: string): boolean {
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
