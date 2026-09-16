import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

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

/** Autopay OrderID: 1–32 znaków, alfanumeryczne plus `-` `_`. */
export const AUTOPAY_ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export function createAutopayOrderId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Autopay BM: hash SHA-256 z `field1|field2|...|SHARED_KEY` (hex lowercase).
 * Puste pola opcjonalne są pomijane (numeracja Autopay).
 */
export function compactHashFields(fields: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  for (const field of fields) {
    if (typeof field !== "string") {
      continue;
    }
    const trimmed = field.trim();
    if (trimmed.length > 0) {
      out.push(trimmed);
    }
  }
  return out;
}

export function generateHash(fields: string[]): string {
  const sharedKey = getRequiredEnv("AUTOPAY_SHARED_KEY");
  const base = [...compactHashFields(fields), sharedKey].join("|");
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
