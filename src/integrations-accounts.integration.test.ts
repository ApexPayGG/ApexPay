import bcrypt from "bcrypt";
import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import { Prisma, ConnectedAccountSubjectType, UserRole } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import { API_KEY_LOOKUP_PREFIX_LENGTH, API_KEY_PUBLIC_PREFIX } from "./services/api-key.service.js";
import type { WebSocketService } from "./services/websocket.service.js";

describe("POST /api/v1/integrations/accounts (integration)", () => {
  const integratorUserId = "integrator_cuid_01";
  let fullApiKey: string;
  let keyHash: string;
  let keyPrefix: string;

  beforeAll(async () => {
    const suffix = "a".repeat(Math.max(0, API_KEY_LOOKUP_PREFIX_LENGTH - API_KEY_PUBLIC_PREFIX.length));
    fullApiKey = `${API_KEY_PUBLIC_PREFIX}${suffix}`;
    expect(fullApiKey.length).toBeGreaterThanOrEqual(API_KEY_LOOKUP_PREFIX_LENGTH);
    keyPrefix = fullApiKey.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH);
    keyHash = await bcrypt.hash(fullApiKey, 4);
  });

  function buildPrisma(overrides?: {
    connectedAccountCreate?: ReturnType<typeof vi.fn>;
  }) {
    const create =
      overrides?.connectedAccountCreate ??
      vi.fn().mockImplementation(
        ({
          data,
        }: {
          data: {
            integratorUserId: string;
            email: string;
            subjectType: ConnectedAccountSubjectType;
            country: string;
          };
        }) =>
          Promise.resolve({
            id: "ca_integration_1",
            integratorUserId: data.integratorUserId,
            userId: null,
            email: data.email,
            subjectType: data.subjectType,
            country: data.country,
            status: "PENDING",
            kycReferenceId: null,
            createdAt: new Date("2026-04-02T12:00:00.000Z"),
            updatedAt: new Date("2026-04-02T12:00:00.000Z"),
          }),
      );

    const auditLogCreate = vi.fn().mockResolvedValue({ id: "audit_1" });
    const $transaction = vi.fn(
      async (
        fn: (tx: {
          connectedAccount: { create: typeof create };
          auditLog: { create: typeof auditLogCreate };
        }) => Promise<unknown>,
      ) => fn({ connectedAccount: { create }, auditLog: { create: auditLogCreate } }),
    );

    const apiKey = {
      findUnique: vi.fn().mockImplementation(
        (args: { where: { prefix: string } }) => {
          if (args.where.prefix !== keyPrefix) {
            return Promise.resolve(null);
          }
          return Promise.resolve({
            id: "apikey_1",
            keyHash,
            prefix: keyPrefix,
            isActive: true,
            expiresAt: null,
            user: { id: integratorUserId, role: UserRole.PLAYER },
          });
        },
      ),
      update: vi.fn().mockResolvedValue({}),
    };

    return {
      apiKey,
      connectedAccount: { create },
      $transaction,
    } as unknown as PrismaClient;
  }

  it("zwraca 401 bez klucza API", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma: buildPrisma(), redis, wsService });

    const res = await request(app).post("/api/v1/integrations/accounts").send({
      email: "seller@example.com",
      type: "INDIVIDUAL",
      country: "PL",
    });
    expect(res.status).toBe(401);
  });

  it("zwraca 400 przy nieprawidłowym body", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma: buildPrisma(), redis, wsService });

    const res = await request(app)
      .post("/api/v1/integrations/accounts")
      .set("x-api-key", fullApiKey)
      .send({
        email: "not-an-email",
        type: "INDIVIDUAL",
        country: "PL",
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_REQUEST");
  });

  it("zwraca 201 i dane subkonta przy poprawnym kluczu i body", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const prisma = buildPrisma();
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .post("/api/v1/integrations/accounts")
      .set("x-api-key", fullApiKey)
      .send({
        email: "Merchant@Example.COM",
        type: "COMPANY",
        country: "de",
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("success");
    expect(res.body.data).toMatchObject({
      id: "ca_integration_1",
      integratorUserId,
      email: "merchant@example.com",
      subjectType: ConnectedAccountSubjectType.COMPANY,
      country: "DE",
      status: "PENDING",
      userId: null,
      kycReferenceId: null,
    });

    const client = prisma as unknown as {
      connectedAccount: { create: ReturnType<typeof vi.fn> };
    };
    expect(client.connectedAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        integratorUserId,
        email: "merchant@example.com",
        subjectType: ConnectedAccountSubjectType.COMPANY,
        country: "DE",
      }),
    });
  });

  it("zwraca 409 gdy create zgłasza P2002 (duplikat)", async () => {
    const dup = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test",
    });
    const create = vi.fn().mockRejectedValue(dup);
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const prisma = buildPrisma({ connectedAccountCreate: create });
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .post("/api/v1/integrations/accounts")
      .set("x-api-key", fullApiKey)
      .send({
        email: "dup@example.com",
        type: "INDIVIDUAL",
        country: "PL",
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });
});
