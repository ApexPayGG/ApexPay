import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  computeResolveIdempotencyHash,
  createIdempotencyResolveMiddleware,
} from "./idempotency-resolve.middleware.js";

describe("computeResolveIdempotencyHash", () => {
  it("is deterministic for matchId and header", () => {
    const a = computeResolveIdempotencyHash("m1", "k1");
    const b = computeResolveIdempotencyHash("m1", "k1");
    expect(a).toBe(b);
    expect(a.length).toBe(64);
  });

  it("differs when header changes", () => {
    expect(computeResolveIdempotencyHash("m1", "a")).not.toBe(
      computeResolveIdempotencyHash("m1", "b"),
    );
  });
});

describe("createIdempotencyResolveMiddleware", () => {
  let redis: {
    eval: ReturnType<typeof vi.fn>;
    multi: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };
  let chain: { set: ReturnType<typeof vi.fn>; exec: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    chain = {
      set: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(["OK", "OK"]),
    };
    redis = {
      eval: vi.fn(),
      multi: vi.fn(() => chain),
      del: vi.fn().mockResolvedValue(1),
    };
  });

  function mockReq(matchId: string, idempotencyKey?: string): Request {
    return {
      params: { id: matchId },
      headers: idempotencyKey
        ? { "idempotency-key": idempotencyKey }
        : {},
    } as Request;
  }

  it("returns 400 when Idempotency-Key is missing", async () => {
    const mw = createIdempotencyResolveMiddleware(redis as never);
    const req = mockReq("m1");
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("returns cached 200 body when Redis returns COMPLETE payload", async () => {
    redis.eval.mockResolvedValue(
      JSON.stringify({ ok: true, cached: true }),
    );
    const mw = createIdempotencyResolveMiddleware(redis as never, {
      ttlSeconds: 60,
    });
    const req = mockReq("m1", "key-a");
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    mw(req, res, next);
    await Promise.resolve();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(body).toEqual({ ok: true, cached: true });
  });

  it("returns 409 when state is PENDING", async () => {
    redis.eval.mockResolvedValue("PENDING");
    const mw = createIdempotencyResolveMiddleware(redis as never);
    const req = mockReq("m1", "key-a");
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    mw(req, res, next);
    await Promise.resolve();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("calls next on ACQUIRED and marks COMPLETE on 2xx json", async () => {
    redis.eval.mockResolvedValue("ACQUIRED");
    const mw = createIdempotencyResolveMiddleware(redis as never);
    const req = mockReq("m1", "key-a");
    const jsonSpy = vi.fn().mockReturnThis();
    const res = {
      statusCode: 200,
      status: vi.fn().mockImplementation((c: number) => {
        (res as { statusCode: number }).statusCode = c;
        return res;
      }),
      json: jsonSpy,
    } as unknown as Response & { statusCode: number };
    const next = vi.fn() as NextFunction;

    mw(req, res, next);
    await Promise.resolve();
    expect(next).toHaveBeenCalled();

    res.status(200);
    jsonSpy.mockImplementation((body: unknown) => {
      expect(body).toEqual({ done: true });
      return res;
    });
    (res.json as (b: unknown) => Response)({ done: true });

    expect(redis.multi).toHaveBeenCalled();
    expect(chain.exec).toHaveBeenCalled();
  });
});
