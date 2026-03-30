import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPspWebhookHmacSha256Hex } from "./psp-webhook-hmac.js";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifyPspWebhookHmacSha256Hex", () => {
  const secret = "whsec_test_only";
  const body = '{"paymentId":"p1","status":"succeeded"}';

  it("returns true for matching hex signature", () => {
    const raw = Buffer.from(body, "utf8");
    expect(verifyPspWebhookHmacSha256Hex(raw, sign(body, secret), secret)).toBe(true);
  });

  it("returns false when secret is empty", () => {
    const raw = Buffer.from(body, "utf8");
    expect(verifyPspWebhookHmacSha256Hex(raw, sign(body, secret), "")).toBe(false);
  });

  it("returns false when header is missing", () => {
    const raw = Buffer.from(body, "utf8");
    expect(verifyPspWebhookHmacSha256Hex(raw, undefined, secret)).toBe(false);
  });

  it("returns false when signature is wrong", () => {
    const raw = Buffer.from(body, "utf8");
    const wrong = "a".repeat(64);
    expect(verifyPspWebhookHmacSha256Hex(raw, wrong, secret)).toBe(false);
  });

  it("returns false when body was tampered (signature for other payload)", () => {
    const raw = Buffer.from(body, "utf8");
    const sigOther = sign('{"paymentId":"p2"}', secret);
    expect(verifyPspWebhookHmacSha256Hex(raw, sigOther, secret)).toBe(false);
  });

  it("accepts uppercase hex in header (normalized to lower)", () => {
    const raw = Buffer.from(body, "utf8");
    const sig = sign(body, secret).toUpperCase();
    expect(verifyPspWebhookHmacSha256Hex(raw, sig, secret)).toBe(true);
  });
});
