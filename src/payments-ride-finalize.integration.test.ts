import bcrypt from "bcrypt";
import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import { UserRole } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import { API_KEY_LOOKUP_PREFIX_LENGTH, API_KEY_PUBLIC_PREFIX } from "./services/api-key.service.js";
import type { WebSocketService } from "./services/websocket.service.js";

describe("POST /api/v1/payments/ride-finalize (integration)", () => {
  const integratorUserId = "integrator_ride_finalize";
  let fullApiKey: string;
  let keyHash: string;
  let keyPrefix: string;

  beforeAll(async () => {
    const suffix = "c".repeat(Math.max(0, API_KEY_LOOKUP_PREFIX_LENGTH - API_KEY_PUBLIC_PREFIX.length));
    fullApiKey = `${API_KEY_PUBLIC_PREFIX}${suffix}`;
    keyPrefix = fullApiKey.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH);
    keyHash = await bcrypt.hash(fullApiKey, 4);
  });

  function buildContext(opts?: {
    passengerBalance?: bigint;
    rideDriverId?: string;
    connectedAccountUserId?: string;
    connectedAccountIntegratorUserId?: string;
  }) {
    const passengerBalance = opts?.passengerBalance ?? 10000n;
    const rideDriverId = opts?.rideDriverId ?? "driver_user_1";
    const connectedAccountUserId = opts?.connectedAccountUserId ?? "driver_user_1";
    const connectedAccountIntegratorUserId = opts?.connectedAccountIntegratorUserId ?? integratorUserId;
    const createdTransactions: Array<{ referenceId: string; amount: bigint; type: string }> = [];
    const tx = {
      safeTaxiRide: {
        findUnique: vi.fn().mockResolvedValue({ id: "ride_1", passengerId: "passenger_1", driverId: rideDriverId }),
      },
      connectedAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: "ca_1",
          userId: connectedAccountUserId,
          integratorUserId: connectedAccountIntegratorUserId,
        }),
      },
      wallet: {
        findUnique: vi.fn().mockImplementation((args: { where: { userId: string } }) => {
          if (args.where.userId === "passenger_1") {
            return Promise.resolve({ id: "w_passenger", balance: passengerBalance });
          }
          if (args.where.userId === connectedAccountUserId) {
            return Promise.resolve({ id: "w_driver" });
          }
          if (args.where.userId === "platform_1") {
            return Promise.resolve({ id: "w_platform" });
          }
          return Promise.resolve(null);
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      transaction: {
        create: vi.fn().mockImplementation((args: { data: { referenceId: string; amount: bigint; type: string } }) => {
          createdTransactions.push({
            referenceId: args.data.referenceId,
            amount: args.data.amount,
            type: args.data.type,
          });
          return Promise.resolve({});
        }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
      webhookOutbox: {
        create: vi.fn().mockResolvedValue({ id: "wo_1" }),
      },
    };

    const prisma = {
      apiKey: {
        findUnique: vi.fn().mockImplementation((args: { where: { prefix: string } }) => {
          if (args.where.prefix !== keyPrefix) {
            return Promise.resolve(null);
          }
          return Promise.resolve({
            id: "apikey_ride_finalize",
            keyHash,
            prefix: keyPrefix,
            isActive: true,
            expiresAt: null,
            user: { id: integratorUserId, role: UserRole.PLAYER },
          });
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;

    return { prisma, tx, createdTransactions };
  }

  function makeRedis(setResult: "OK" | null = "OK"): Redis {
    return {
      ping: vi.fn().mockResolvedValue("PONG"),
      set: vi.fn().mockResolvedValue(setResult),
      del: vi.fn().mockResolvedValue(1),
    } as unknown as Redis;
  }

  function makeStatefulRedis(): Redis {
    const keys = new Set<string>();
    return {
      ping: vi.fn().mockResolvedValue("PONG"),
      set: vi.fn().mockImplementation((key: string) => {
        if (keys.has(key)) {
          return Promise.resolve(null);
        }
        keys.add(key);
        return Promise.resolve("OK");
      }),
      del: vi.fn().mockImplementation((key: string) => Promise.resolve(keys.delete(key) ? 1 : 0)),
    } as unknown as Redis;
  }

  function makeWs(): WebSocketService {
    return { notifyWallet: vi.fn() } as unknown as WebSocketService;
  }

  const payload = {
    ride_id: "ride_1",
    base_amount_grosze: 1000,
    platform_commission_grosze: 200,
    driver_base_payout_grosze: 800,
    tip_amount_grosze: 50,
    tip_settlement: "CREDIT_CONNECTED_ACCOUNT",
    passenger_rating_stars: 5,
    driver_connected_account_id: "ca_1",
  };

  it("401 bez klucza API", async () => {
    const { prisma } = buildContext();
    const { app } = createApp({ prisma, redis: makeRedis(), wsService: makeWs() });
    const res = await request(app).post("/api/v1/payments/ride-finalize").send(payload);
    expect(res.status).toBe(401);
  });

  it("400 gdy split jest nieprawidłowy", async () => {
    const { prisma } = buildContext();
    const { app } = createApp({ prisma, redis: makeRedis(), wsService: makeWs() });
    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send({
        ...payload,
        platform_commission_grosze: 100,
        driver_base_payout_grosze: 100,
      });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("Nieprawidłowy split");
  });

  it("201 dla poprawnego splitu i wpisy w ledgerze", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, createdTransactions } = buildContext();
    const { app } = createApp({ prisma, redis: makeRedis("OK"), wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      rideId: "ride_1",
      driverPayout: 850,
      platformCommission: 200,
      tip: 50,
      duplicate: false,
    });
    expect(createdTransactions.map((t) => t.referenceId)).toEqual(
      expect.arrayContaining([
        "ride:ride_1:debit",
        "ride:ride_1:driver",
        "ride:ride_1:platform",
        "ride:ride_1:tip",
      ]),
    );
    vi.unstubAllEnvs();
  });

  it("200 duplicate:true dla duplikatu ride_id", async () => {
    const { prisma } = buildContext();
    const { app } = createApp({ prisma, redis: makeRedis(null), wsService: makeWs() });
    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ duplicate: true, rideId: "ride_1" });
  });

  it("201 gdy pay-in był wcześniej (saldo pasażera = 0) — skip debetu pasażera, credity wykonane", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, createdTransactions } = buildContext({ passengerBalance: 0n });
    const { app } = createApp({ prisma, redis: makeRedis("OK"), wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      rideId: "ride_1",
      driverPayout: 850,
      platformCommission: 200,
      tip: 50,
      duplicate: false,
    });

    const refs = createdTransactions.map((t) => t.referenceId);
    expect(refs).not.toContain("ride:ride_1:debit");
    expect(refs).toEqual(
      expect.arrayContaining([
        "ride:ride_1:driver",
        "ride:ride_1:platform",
        "ride:ride_1:tip",
      ]),
    );
    vi.unstubAllEnvs();
  });

  it("404 gdy subkonto kierowcy nie należy do kierowcy przypisanego do przejazdu", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, tx } = buildContext({
      rideDriverId: "expected_driver_user",
      connectedAccountUserId: "other_driver_user",
    });
    const { app } = createApp({ prisma, redis: makeRedis("OK"), wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "NOT_FOUND" });
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("404 gdy klucz API nie należy do integratora subkonta kierowcy", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, tx } = buildContext({ connectedAccountIntegratorUserId: "other_integrator" });
    const { app } = createApp({ prisma, redis: makeRedis("OK"), wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "NOT_FOUND" });
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("nie blokuje poprawnego rozliczenia po odrzuconej próbie z błędnym subkontem", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const redis = makeStatefulRedis();
    const rejected = buildContext({
      rideDriverId: "expected_driver_user",
      connectedAccountUserId: "other_driver_user",
    });
    const rejectedApp = createApp({ prisma: rejected.prisma, redis, wsService: makeWs() }).app;

    const rejectedRes = await request(rejectedApp)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);
    expect(rejectedRes.status).toBe(404);

    const accepted = buildContext();
    const acceptedApp = createApp({ prisma: accepted.prisma, redis, wsService: makeWs() }).app;
    const acceptedRes = await request(acceptedApp)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(acceptedRes.status).toBe(201);
    expect(accepted.createdTransactions.map((t) => t.referenceId)).toEqual(
      expect.arrayContaining(["ride:ride_1:debit", "ride:ride_1:driver", "ride:ride_1:platform"]),
    );
    vi.unstubAllEnvs();
  });
});
