import { createHmac } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { createHmacSignatureMiddleware } from "./hmac-signature.middleware.js";

function sign(secret: string, raw: Buffer): string {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

describe("createHmacSignatureMiddleware", () => {
  it("calls next when secret is missing", () => {
    const mw = createHmacSignatureMiddleware({ secretKeys: [] });
    const req = { headers: {}, rawBody: Buffer.from("{}") } as Request;
    const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 when header is missing", () => {
    const mw = createHmacSignatureMiddleware({ secretKeys: ["k"] });
    const req = { headers: {}, rawBody: Buffer.from("{}") } as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when signature does not match", () => {
    const mw = createHmacSignatureMiddleware({ secretKeys: ["secret"] });
    const raw = Buffer.from('{"a":1}');
    const req = {
      headers: { "x-signature": "deadbeef" },
      rawBody: raw,
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when HMAC matches raw body", () => {
    const secret = "api-secret";
    const raw = Buffer.from('{"finalWinnerId":"w1"}');
    const mw = createHmacSignatureMiddleware({ secretKeys: [secret] });
    const req = {
      headers: { "x-signature": sign(secret, raw) },
      rawBody: raw,
    } as unknown as Request;
    const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("accepts signature from any of multiple rotated keys", () => {
    const oldKey = "old-secret";
    const newKey = "new-secret";
    const raw = Buffer.from('{"x":1}');
    const mw = createHmacSignatureMiddleware({
      secretKeys: [newKey, oldKey],
    });
    const req = {
      headers: { "x-signature": sign(oldKey, raw) },
      rawBody: raw,
    } as unknown as Request;
    const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
