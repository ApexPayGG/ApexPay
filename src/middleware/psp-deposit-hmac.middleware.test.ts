import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createPspDepositWebhookHmacMiddleware,
  PSP_DEPOSIT_SIGNATURE_HEADER,
} from "./psp-deposit-hmac.middleware.js";

function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function createRes() {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  return { status, json };
}

describe("createPspDepositWebhookHmacMiddleware", () => {
  const secret = "whsec_unit_test";
  const getSecret = () => secret;

  it("returns 503 when secret is missing", () => {
    const mw = createPspDepositWebhookHmacMiddleware(() => undefined);
    const res = createRes();
    const next = vi.fn();
    mw({ rawBody: Buffer.from("{}"), get: () => undefined } as never, res as never, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 when rawBody is missing", () => {
    const mw = createPspDepositWebhookHmacMiddleware(getSecret);
    const res = createRes();
    const next = vi.fn();
    mw({ get: () => undefined } as never, res as never, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when signature is invalid", () => {
    const mw = createPspDepositWebhookHmacMiddleware(getSecret);
    const bodyStr = '{"pspRefId":"p","userId":"u","amount":1,"currency":"PLN","status":"SUCCESS"}';
    const res = createRes();
    const next = vi.fn();
    const req = {
      rawBody: Buffer.from(bodyStr, "utf8"),
      get: (h: string) => (h === PSP_DEPOSIT_SIGNATURE_HEADER ? "00".repeat(32) : undefined),
    };
    mw(req as never, res as never, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when signature is valid", () => {
    const mw = createPspDepositWebhookHmacMiddleware(getSecret);
    const bodyStr = '{"pspRefId":"p","userId":"u","amount":1,"currency":"PLN","status":"SUCCESS"}';
    const res = createRes();
    const next = vi.fn();
    const req = {
      rawBody: Buffer.from(bodyStr, "utf8"),
      get: (h: string) =>
        h === PSP_DEPOSIT_SIGNATURE_HEADER ? signBody(bodyStr, secret) : undefined,
    };
    mw(req as never, res as never, next);
    expect(next).toHaveBeenCalled();
  });
});
