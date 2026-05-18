import bcrypt from "bcrypt";
import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import { ConnectedAccountStatus, SafeTaxiRideStatus, UserRole } from "@prisma/client";
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
    completedFinalize?: boolean;
    ride?: { id: string; passengerId: string; driverId: string; status: SafeTaxiRideStatus };
    connectedAccount?: { id: string; userId: string | null; integratorUserId: string; status: ConnectedAccountStatus };
  }) {
    const passengerBalance = opts?.passengerBalance ?? 10000n;
    const completedFinalize = opts?.completedFinalize ?? false;
    const createdTransactions: Array<{ referenceId: string; amount: bigint; type: string }> = [];
    const ride = opts?.ride ?? {
      id: "ride_1",
      passengerId: "passenger_1",
      driverId: "driver_user_1",
      status: SafeTaxiRideStatus.CREATED,
    };
    const connectedAccount = opts?.connectedAccount ?? {
      id: "ca_1",
      userId: "driver_user_1",
      integratorUserId,
      status: ConnectedAccountStatus.ACTIVE,
    };
    const tx = {
      safeTaxiRide: {
        findUnique: vi.fn().mockResolvedValue(ride),
        update: vi.fn().mockResolvedValue({}),
      },
      connectedAccount: {
        findUnique: vi.fn().mockResolvedValue(connectedAccount),
      },
      wallet: {
        findUnique: vi.fn().mockImplementation((args: { where: { userId: string } }) => {
          if (args.where.userId === "passenger_1") {
            return Promise.resolve({ id: "w_passenger", balance: passengerBalance });
          }
          if (args.where.userId === "driver_user_1") {
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
      safeTaxiRide: {
        findUnique: vi.fn().mockResolvedValue({
          status: completedFinalize ? SafeTaxiRideStatus.SETTLED : ride.status,
          driverId: ride.driverId,
        }),
      },
      transaction: {
        findUnique: vi.fn().mockResolvedValue(completedFinalize ? { id: "t_debit" } : null),
      },
      connectedAccount: {
        findUnique: vi.fn().mockResolvedValue(connectedAccount),
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

  function postFinalize(app: ReturnType<typeof createApp>["app"], body: typeof payload = payload) {
    return request(app).post("/api/v1/payments/ride-finalize").set("x-api-key", fullApiKey).send(body);
  }

  it("401 bez klucza API", async () => {
    const { prisma } = buildContext();
    const { app } = createApp({ prisma, redis: makeRedis(), wsService: makeWs() });
    const res = await request(app).post("/api/v1/payments/ride-finalize").send(payload);
    expect(res.status).toBe(401);
  });

  it("400 gdy split jest nieprawidłowy", async () => {
    const { prisma } = buildContext();
    const { app } = createApp({ prisma, redis: makeRedis(), wsService: makeWs() });
    const res = await postFinalize(app, {
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

    const res = await postFinalize(app);

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
    expect(createdTransactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ referenceId: "ride:ride_1:debit", amount: -1050n }),
        expect.objectContaining({ referenceId: "ride:ride_1:driver", amount: 800n }),
        expect.objectContaining({ referenceId: "ride:ride_1:platform", amount: 200n }),
        expect.objectContaining({ referenceId: "ride:ride_1:tip", amount: 50n }),
      ]),
    );
    vi.unstubAllEnvs();
  });

  it("409 dla duplikatu ride_id bez trwałego rozliczenia", async () => {
    const { prisma } = buildContext();
    const { app } = createApp({ prisma, redis: makeRedis(null), wsService: makeWs() });
    const res = await postFinalize(app);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "CONFLICT" });
  });

  it("200 duplicate:true dla duplikatu ride_id po trwałym rozliczeniu", async () => {
    const { prisma } = buildContext({ completedFinalize: true });
    const { app } = createApp({ prisma, redis: makeRedis(null), wsService: makeWs() });
    const res = await postFinalize(app);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ duplicate: true, rideId: "ride_1" });
  });

  it("403 dla duplikatu po trwałym rozliczeniu z cudzym subkontem", async () => {
    const { prisma } = buildContext({
      completedFinalize: true,
      connectedAccount: { id: "ca_1", userId: "driver_user_1", integratorUserId: "other_integrator", status: ConnectedAccountStatus.ACTIVE },
    });
    const { app } = createApp({ prisma, redis: makeRedis(null), wsService: makeWs() });
    const res = await postFinalize(app);
    expect(res.status).toBe(403);
  });

  it("403 gdy subkonto kierowcy należy do innego integratora", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, createdTransactions } = buildContext({
      connectedAccount: {
        id: "ca_1",
        userId: "driver_user_1",
        integratorUserId: "other_integrator",
        status: ConnectedAccountStatus.ACTIVE,
      },
    });
    const redis = makeRedis("OK");
    const { app } = createApp({ prisma, redis, wsService: makeWs() });
    const res = await postFinalize(app);
    expect(res.status).toBe(403);
    expect(createdTransactions).toHaveLength(0);
    expect(redis.del).toHaveBeenCalledWith("idemp:ride-finalize:ride_1");
    vi.unstubAllEnvs();
  });

  it("403 gdy subkonto nie należy do kierowcy przejazdu", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, createdTransactions } = buildContext({
      connectedAccount: {
        id: "ca_1",
        userId: "other_driver",
        integratorUserId,
        status: ConnectedAccountStatus.ACTIVE,
      },
    });
    const redis = makeRedis("OK");
    const { app } = createApp({ prisma, redis, wsService: makeWs() });
    const res = await postFinalize(app);
    expect(res.status).toBe(403);
    expect(createdTransactions).toHaveLength(0);
    expect(redis.del).toHaveBeenCalledWith("idemp:ride-finalize:ride_1");
    vi.unstubAllEnvs();
  });

  it("409 gdy przejazd został już rozliczony", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, createdTransactions } = buildContext({
      ride: {
        id: "ride_1",
        passengerId: "passenger_1",
        driverId: "driver_user_1",
        status: SafeTaxiRideStatus.SETTLED,
      },
    });
    const redis = makeRedis("OK");
    const { app } = createApp({ prisma, redis, wsService: makeWs() });

    const res = await postFinalize(app);

    expect(res.status).toBe(409);
    expect(createdTransactions).toHaveLength(0);
    expect(redis.del).toHaveBeenCalledWith("idemp:ride-finalize:ride_1");
    vi.unstubAllEnvs();
  });

  it("402 gdy saldo pasażera nie pokrywa opłaty — bez kredytów driver/platforma", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, createdTransactions } = buildContext({ passengerBalance: 1000n });
    const redis = makeRedis("OK");
    const { app } = createApp({ prisma, redis, wsService: makeWs() });
    const res = await postFinalize(app);

    expect(res.status).toBe(402);
    expect(createdTransactions).toHaveLength(0);
    expect(redis.del).toHaveBeenCalledWith("idemp:ride-finalize:ride_1");
    vi.unstubAllEnvs();
  });
});
