import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { createResolveRateLimitMiddleware } from "./resolve-rate-limit.middleware.js";

describe("createResolveRateLimitMiddleware", () => {
  let redis: { eval: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    redis = { eval: vi.fn() };
  });

  it("returns 401 when req.user.id is missing", async () => {
    redis.eval.mockResolvedValue([1, 1]);
    const mw = createResolveRateLimitMiddleware(redis as never);
    const req = { user: undefined } as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    mw(req, res, next);

    await vi.waitFor(() => {
      expect(res.status).toHaveBeenCalledWith(401);
    });
    expect(redis.eval).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 429 when Lua returns not allowed", async () => {
    redis.eval.mockResolvedValue([0, 5]);
    const mw = createResolveRateLimitMiddleware(redis as never);
    const req = { user: { id: "u1" } } as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    mw(req, res, next);

    await vi.waitFor(() => {
      expect(res.status).toHaveBeenCalledWith(429);
    });
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "60");
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when Lua allows", async () => {
    redis.eval.mockResolvedValue([1, 3]);
    const mw = createResolveRateLimitMiddleware(redis as never);
    const req = { user: { id: "u1" } } as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    mw(req, res, next);

    await vi.waitFor(() => {
      expect(next).toHaveBeenCalledTimes(1);
    });
    expect(res.status).not.toHaveBeenCalled();
  });
});
