import { describe, expect, it } from "vitest";
import {
  signWebhookPayloadBody,
  verifyWebhookSignature,
  webhookRetryDelayMs,
} from "./webhook-dispatcher.service.js";

describe("webhookRetryDelayMs", () => {
  it("1 min → 5 min → 1 h dla kolejnych prób", () => {
    expect(webhookRetryDelayMs(1)).toBe(60_000);
    expect(webhookRetryDelayMs(2)).toBe(5 * 60_000);
    expect(webhookRetryDelayMs(3)).toBe(60 * 60_000);
    expect(webhookRetryDelayMs(4)).toBe(60 * 60_000);
  });
});

describe("signWebhookPayloadBody / verifyWebhookSignature", () => {
  it("HMAC-SHA256 hex jest spójny i weryfikowalny", () => {
    const secret = "whsec_test";
    const body = '{"id":"c1","status":"SUCCESS"}';
    const sig = signWebhookPayloadBody(body, secret);
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyWebhookSignature(body, secret, sig)).toBe(true);
    expect(verifyWebhookSignature(body + "x", secret, sig)).toBe(false);
  });
});
