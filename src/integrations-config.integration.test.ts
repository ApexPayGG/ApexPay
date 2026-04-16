import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import { UserRole } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import { API_KEY_LOOKUP_PREFIX_LENGTH, API_KEY_PUBLIC_PREFIX } from "./services/api-key.service.js";
import type { WebSocketService } from "./services/websocket.service.js";

describe("/api/v1/integrations/config (integration)", () => {
  const integratorUserId = "integrator_cfg_01";
  let fullApiKey: string;
  let keyHash: string;
  let keyPrefix: string;

  beforeAll(async () => {
    const suffix = "a".repeat(Math.max(0, API_KEY_LOOKUP_PREFIX_LENGTH - API_KEY_PUBLIC_PREFIX.length));
    fullApiKey = `${API_KEY_PUBLIC_PREFIX}${suffix}`;
    keyPrefix = fullApiKey.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH);
    keyHash = await bcrypt.hash(fullApiKey, 4);
  });

  type ConfigRow = {
    id: string;
    userId: string;
    webhookUrl: string | null;
    webhookSecret: string;
    createdAt: Date;
    updatedAt: Date;
  };

  function buildPrisma(initial: ConfigRow | null = null) {
    let row: ConfigRow | null = initial;

    const apiKey = {
      findUnique: vi.fn().mockImplementation((args: { where: { prefix: string } }) => {
        if (args.where.prefix !== keyPrefix) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          id: "apikey_cfg",
          keyHash,
          prefix: keyPrefix,
          isActive: true,
          expiresAt: null,
          user: { id: integratorUserId, role: UserRole.PLAYER },
        });
      }),
      update: vi.fn().mockResolvedValue({}),
    };

    const integratorConfig = {
      findUnique: vi.fn().mockImplementation((args: { where: { userId: string } }) => {
        if (args.where.userId !== integratorUserId) {
          return Promise.resolve(null);
        }
        return Promise.resolve(row === null ? null : { ...row });
      }),
      create: vi.fn().mockImplementation(
        ({
          data,
        }: {
          data: {
            userId: string;
            webhookUrl: string | null;
            webhookSecret: string;
          };
        }) => {
          const now = new Date("2026-04-11T10:00:00.000Z");
          row = {
            id: "ic_new",
            userId: data.userId,
            webhookUrl: data.webhookUrl,
            webhookSecret: data.webhookSecret,
            createdAt: now,
            updatedAt: now,
          };
          return Promise.resolve({ ...row });
        },
      ),
      update: vi.fn().mockImplementation(
        ({
          data,
        }: {
          data: { webhookUrl: string | null };
        }) => {
          if (row === null) {
            throw new Error("unexpected update without row");
          }
          const next: ConfigRow = {
            ...row,
            webhookUrl: data.webhookUrl,
            updatedAt: new Date("2026-04-11T11:00:00.000Z"),
          };
          row = next;
          return Promise.resolve({ ...next });
        },
      ),
    };

    return {
      apiKey,
      integratorConfig,
    } as unknown as PrismaClient;
  }

  it("GET z JWT Bearer (bez klucza API) — 200, data: null", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma: buildPrisma(null), redis, wsService });

    const token = jwt.sign(
      { userId: integratorUserId, role: UserRole.PLAYER },
      process.env.JWT_SECRET || "dev-secret",
    );

    const res = await request(app)
      .get("/api/v1/integrations/config")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.data).toBeNull();
  });

  it("GET i PUT bez klucza API i bez JWT → 401", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma: buildPrisma(null), redis, wsService });

    const getRes = await request(app).get("/api/v1/integrations/config");
    expect(getRes.status).toBe(401);

    const putRes = await request(app)
      .put("/api/v1/integrations/config")
      .send({ webhookUrl: "https://example.com/hook" });
    expect(putRes.status).toBe(401);
  });

  it("GET z kluczem, brak konfiguracji → 200 i data: null", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma: buildPrisma(null), redis, wsService });

    const res = await request(app)
      .get("/api/v1/integrations/config")
      .set("x-api-key", fullApiKey);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.data).toBeNull();
  });

  it("PUT z kluczem — tworzy config, zwraca webhookSecret (64 znaki hex)", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const prisma = buildPrisma(null);
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .put("/api/v1/integrations/config")
      .set("x-api-key", fullApiKey)
      .send({ webhookUrl: "https://hooks.example.com/apexpay" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.data.webhookUrl).toBe("https://hooks.example.com/apexpay");
    expect(res.body.data.webhookSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.data.userId).toBe(integratorUserId);

    const client = prisma as unknown as {
      integratorConfig: { create: ReturnType<typeof vi.fn> };
    };
    expect(client.integratorConfig.create).toHaveBeenCalledTimes(1);
  });

  it("PUT z niepoprawnym URL → 400", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma: buildPrisma(null), redis, wsService });

    const res = await request(app)
      .put("/api/v1/integrations/config")
      .set("x-api-key", fullApiKey)
      .send({ webhookUrl: "not-a-url" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_REQUEST");
  });

  it("drugi PUT aktualizuje tylko URL — sekret bez zmian", async () => {
    const existing: ConfigRow = {
      id: "ic_existing",
      userId: integratorUserId,
      webhookUrl: "https://old.example/hook",
      webhookSecret: "a".repeat(64),
      createdAt: new Date("2026-04-10T08:00:00.000Z"),
      updatedAt: new Date("2026-04-10T08:00:00.000Z"),
    };
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const prisma = buildPrisma(existing);
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .put("/api/v1/integrations/config")
      .set("x-api-key", fullApiKey)
      .send({ webhookUrl: "https://new.example/hook" });

    expect(res.status).toBe(200);
    expect(res.body.data.webhookUrl).toBe("https://new.example/hook");
    expect(res.body.data.webhookSecret).toBe("a".repeat(64));

    const client = prisma as unknown as {
      integratorConfig: { update: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    };
    expect(client.integratorConfig.update).toHaveBeenCalled();
    expect(client.integratorConfig.create).not.toHaveBeenCalled();
  });
});
