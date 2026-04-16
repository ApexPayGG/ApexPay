import bcrypt from "bcrypt";
import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import { UserRole } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import { API_KEY_LOOKUP_PREFIX_LENGTH, API_KEY_PUBLIC_PREFIX } from "./services/api-key.service.js";
import type { WebSocketService } from "./services/websocket.service.js";

describe("integrations CSV export endpoints", () => {
  const integratorUserId = "integrator_export_01";
  let fullApiKey: string;
  let keyHash: string;
  let keyPrefix: string;

  beforeAll(async () => {
    const suffix = "b".repeat(Math.max(0, API_KEY_LOOKUP_PREFIX_LENGTH - API_KEY_PUBLIC_PREFIX.length));
    fullApiKey = `${API_KEY_PUBLIC_PREFIX}${suffix}`;
    keyPrefix = fullApiKey.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH);
    keyHash = await bcrypt.hash(fullApiKey, 4);
  });

  function buildPrisma(): PrismaClient {
    return {
      apiKey: {
        findUnique: vi.fn().mockImplementation((args: { where: { prefix: string } }) => {
          if (args.where.prefix !== keyPrefix) {
            return Promise.resolve(null);
          }
          return Promise.resolve({
            id: "apikey_export",
            keyHash,
            prefix: keyPrefix,
            isActive: true,
            expiresAt: null,
            user: { id: integratorUserId, role: UserRole.PLAYER },
          });
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      marketplaceCharge: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "chg_1",
            amountCents: 12345n,
            currency: "PLN",
            createdAt: new Date("2026-04-16T10:00:00.000Z"),
          },
        ]),
      },
      transaction: {
        findMany: vi.fn().mockResolvedValue([{ referenceId: "mkt:chg_1:credit:ca_1" }]),
      },
      payout: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "pout_1",
            amount: 9900n,
            currency: "PLN",
            status: "PAID",
            pspReferenceId: "psp_ref_1",
            createdAt: new Date("2026-04-16T12:00:00.000Z"),
            connectedAccount: {
              id: "ca_1",
              email: "ca1@example.com",
            },
          },
        ]),
      },
    } as unknown as PrismaClient;
  }

  it("GET /api/v1/integrations/charges/export zwraca CSV i nagłówki", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma: buildPrisma(), redis, wsService });

    const res = await request(app)
      .get("/api/v1/integrations/charges/export")
      .set("x-api-key", fullApiKey);

    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/csv");
    expect(String(res.headers["content-disposition"])).toContain("attachment; filename=\"charges_");

    const text = res.text.startsWith("\uFEFF") ? res.text.slice(1) : res.text;
    const firstLine = text.split("\r\n")[0];
    expect(firstLine).toBe("ID,Kwota (PLN),Waluta,Subkonto ID,Status,Data utworzenia");
  });

  it("GET /api/v1/integrations/payouts/export zwraca CSV i nagłówki", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma: buildPrisma(), redis, wsService });

    const res = await request(app)
      .get("/api/v1/integrations/payouts/export")
      .set("x-api-key", fullApiKey);

    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/csv");
    expect(String(res.headers["content-disposition"])).toContain("attachment; filename=\"payouts_");

    const text = res.text.startsWith("\uFEFF") ? res.text.slice(1) : res.text;
    const firstLine = text.split("\r\n")[0];
    expect(firstLine).toBe("ID,Kwota (PLN),Waluta,Subkonto ID,Status,PSP Reference ID,Data utworzenia");
  });
});
