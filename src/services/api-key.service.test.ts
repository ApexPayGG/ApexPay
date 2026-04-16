import bcrypt from "bcrypt";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { UserRole } from "@prisma/client";
import {
  API_KEY_LOOKUP_PREFIX_LENGTH,
  API_KEY_PUBLIC_PREFIX,
  ApiKeyService,
} from "./api-key.service.js";

describe("ApiKeyService.validateKey", () => {
  it("zwraca null gdy brak prefiksu apx_live_", async () => {
    const prisma = {} as PrismaClient;
    const s = new ApiKeyService(prisma);
    expect(await s.validateKey("sk_live_xyz", { touchLastUsed: false })).toBeNull();
  });

  it("zwraca null gdy klucz krótszy niż długość prefiksu lookup", async () => {
    const prisma = {} as PrismaClient;
    const s = new ApiKeyService(prisma);
    expect(
      await s.validateKey(`${API_KEY_PUBLIC_PREFIX}short`, { touchLastUsed: false }),
    ).toBeNull();
  });

  it("weryfikuje bcrypt i zwraca userId po trafieniu po prefix", async () => {
    const suffix = "test_suffix_padding______________________________";
    const fullKey = `${API_KEY_PUBLIC_PREFIX}${suffix}`;
    expect(fullKey.length).toBeGreaterThanOrEqual(API_KEY_LOOKUP_PREFIX_LENGTH);
    const prefix = fullKey.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH);
    const keyHash = await bcrypt.hash(fullKey, 12);

    const findUnique = vi.fn().mockResolvedValue({
      id: "k1",
      userId: "user-1",
      keyHash,
      prefix,
      name: "k",
      lastUsedAt: null,
      expiresAt: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: "user-1", role: UserRole.PLAYER },
    });
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      apiKey: { findUnique, update },
    } as unknown as PrismaClient;

    const s = new ApiKeyService(prisma);
    const out = await s.validateKey(fullKey, { touchLastUsed: false });

    expect(out).toEqual({
      userId: "user-1",
      role: UserRole.PLAYER,
      apiKeyId: "k1",
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { prefix },
      include: { user: { select: { id: true, role: true } } },
    });
    expect(update).not.toHaveBeenCalled();
  });
});
