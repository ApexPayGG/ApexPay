import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { createApiKeyAuthMiddleware } from "./api-key-auth.middleware.js";
import type { ApiKeyService } from "../services/api-key.service.js";
import { UserRole } from "@prisma/client";

function createRes() {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  return { status, json };
}

describe("createApiKeyAuthMiddleware", () => {
  it("401 gdy brak x-api-key i Bearer nie jest kluczem apx_live_", async () => {
    const validateKey = vi.fn();
    const mw = createApiKeyAuthMiddleware({ validateKey } as unknown as ApiKeyService);
    const res = createRes();
    const next = vi.fn();
    const req = {
      get: (h: string) => (h === "authorization" ? "Bearer eyJhbGc" : undefined),
    } as unknown as Request;
    await mw(req, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(validateKey).not.toHaveBeenCalled();
  });

  it("401 gdy validateKey zwraca null", async () => {
    const validateKey = vi.fn().mockResolvedValue(null);
    const mw = createApiKeyAuthMiddleware({ validateKey } as unknown as ApiKeyService);
    const res = createRes();
    const next = vi.fn();
    const req = {
      get: (h: string) => (h === "x-api-key" ? "apx_live_xxxxxxxxxxxxxxxxxxxxxxxxx" : undefined),
    } as unknown as Request;
    await mw(req, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("ustawia req.user i next przy sukcesie", async () => {
    const validateKey = vi.fn().mockResolvedValue({
      userId: "u1",
      role: UserRole.ADMIN,
      apiKeyId: "k1",
    });
    const mw = createApiKeyAuthMiddleware({ validateKey } as unknown as ApiKeyService);
    const res = createRes();
    const next = vi.fn();
    const req = { get: (h: string) => (h === "x-api-key" ? "apx_live_ok" : undefined), user: undefined } as unknown as Request;
    await mw(req, res as unknown as Response, next);
    expect(req.user).toEqual({ id: "u1", role: UserRole.ADMIN });
    expect(next).toHaveBeenCalled();
  });
});
