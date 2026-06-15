import bcrypt from "bcrypt";
import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import { ConnectedAccountStatus, RidePaymentMethod, SafeTaxiRideStatus, UserRole } from "@prisma/client";
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
    rideStatus?: SafeTaxiRideStatus;
    rideDriverId?: string;
    connectedAccountUserId?: string;
    connectedAccountIntegratorUserId?: string;
    connectedAccountStatus?: ConnectedAccountStatus;
    walletMissing?: boolean;
  }) {
    const passengerBalance = opts?.passengerBalance ?? 10000n;
    const createdTransactions: Array<{ referenceId: string; amount: bigint; type: string }> = [];
    const tx = {
      safeTaxiRide: {
        findUnique: vi.fn().mockResolvedValue({
          id: "ride_1",
          passengerId: "passenger_1",
          driverId: opts?.rideDriverId ?? "driver_user_1",
          paymentMethod: RidePaymentMethod.CARD,
          status: opts?.rideStatus ?? SafeTaxiRideStatus.CREATED,
          platformCommissionCents: 200n,
          driverPayoutCents: 850n,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      connectedAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: "ca_1",
          userId: opts?.connectedAccountUserId ?? "driver_user_1",
          integratorUserId: opts?.connectedAccountIntegratorUserId ?? integratorUserId,
          status: opts?.connectedAccountStatus ?? ConnectedAccountStatus.ACTIVE,
        }),
      },
      wallet: {
        findUnique: vi.fn().mockImplementation((args: { where: { userId: string } }) => {
          if (opts?.walletMissing === true) {
            return Promise.resolve(null);
          }
          if (args.where.userId === "passenger_1") {
            return Promise.resolve({ id: "w_passenger" });
          }
          if (args.where.userId === "driver_user_1") {
            return Promise.resolve({ id: "w_driver" });
          }
          if (args.where.userId === "platform_1") {
            return Promise.resolve({ id: "w_platform" });
          }
          return Promise.resolve(null);
        }),
        updateMany: vi.fn().mockImplementation((args: { where: { id: string; balance?: { gte?: bigint } } }) => {
          if (args.where.id === "w_passenger" && passengerBalance >= (args.where.balance?.gte ?? 0n)) {
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      transaction: {
        findUnique: vi.fn().mockResolvedValue(null),
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
      safeTaxiRide: tx.safeTaxiRide,
      connectedAccount: tx.connectedAccount,
      transaction: tx.transaction,
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
    expect(createdTransactions.find((t) => t.referenceId === "ride:ride_1:debit")?.amount).toBe(-1050n);
    vi.unstubAllEnvs();
  });

  it("200 duplicate:true dla duplikatu ride_id tylko gdy DB potwierdza zakończone rozliczenie", async () => {
    const { prisma, tx } = buildContext({ rideStatus: SafeTaxiRideStatus.SETTLED });
    tx.transaction.findUnique.mockImplementation((args: { where: { referenceId: string } }) => {
      if (args.where.referenceId === "ride:ride_1:driver") {
        return Promise.resolve({ id: "txn_driver", referenceId: "ride:ride_1:driver" });
      }
      if (args.where.referenceId === "ride:ride_1:tip") {
        return Promise.resolve({ id: "txn_tip", referenceId: "ride:ride_1:tip", amount: 50n });
      }
      return Promise.resolve(null);
    });
    const { app } = createApp({ prisma, redis: makeRedis(null), wsService: makeWs() });
    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      duplicate: true,
      rideId: "ride_1",
      driverPayout: 850,
      platformCommission: 200,
      tip: 50,
    });
  });

  it("409 dla duplikatu ride_id gdy Redis istnieje, ale DB nie potwierdza rozliczenia", async () => {
    const { prisma, tx } = buildContext({ rideStatus: SafeTaxiRideStatus.CREATED });
    tx.transaction.findUnique.mockResolvedValue(null);
    const { app } = createApp({ prisma, redis: makeRedis(null), wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });

  it("403 gdy connected account nie należy do integratora z klucza API", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, tx } = buildContext({
      connectedAccountIntegratorUserId: "other_integrator",
    });
    const { app } = createApp({ prisma, redis: makeRedis("OK"), wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(403);
    expect(tx.transaction.create).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("403 gdy connected account nie jest kierowcą przypisanym do przejazdu", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, tx } = buildContext({
      connectedAccountUserId: "other_driver",
    });
    const { app } = createApp({ prisma, redis: makeRedis("OK"), wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(403);
    expect(tx.transaction.create).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("409 gdy przejazd jest już rozliczony przez inny path", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, tx } = buildContext({ rideStatus: SafeTaxiRideStatus.SETTLED });
    tx.transaction.findUnique.mockResolvedValue(null);
    const { app } = createApp({ prisma, redis: makeRedis("OK"), wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(409);
    expect(tx.transaction.create).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("402 gdy saldo pasażera nie pokrywa base + tip", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, tx } = buildContext({ passengerBalance: 1000n });
    const { app } = createApp({ prisma, redis: makeRedis("OK"), wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(402);
    expect(tx.transaction.create).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("zwalnia Redis idempotency key po błędzie przed commitem", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma } = buildContext({ walletMissing: true });
    const redis = makeRedis("OK");
    const { app } = createApp({ prisma, redis, wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(404);
    expect(redis.del).toHaveBeenCalledWith("idemp:ride-finalize:ride_1");
    vi.unstubAllEnvs();
  });
});
