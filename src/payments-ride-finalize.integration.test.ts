import bcrypt from "bcrypt";
import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import {
  ConnectedAccountStatus,
  RidePaymentMethod,
  SafeTaxiRideStatus,
  UserRole,
} from "@prisma/client";
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
    paymentMethod?: RidePaymentMethod;
    connectedAccountStatus?: ConnectedAccountStatus;
    connectedAccountIntegratorUserId?: string;
    connectedAccountUserId?: string | null;
  }) {
    const passengerBalance = opts?.passengerBalance ?? 10000n;
    const rideStatus = opts?.rideStatus ?? SafeTaxiRideStatus.CREATED;
    const paymentMethod = opts?.paymentMethod ?? RidePaymentMethod.CARD;
    const connectedAccountStatus = opts?.connectedAccountStatus ?? ConnectedAccountStatus.ACTIVE;
    const connectedAccountIntegratorUserId =
      opts?.connectedAccountIntegratorUserId ?? integratorUserId;
    const connectedAccountUserId = opts?.connectedAccountUserId ?? "driver_user_1";
    const createdTransactions: Array<{ referenceId: string; amount: bigint; type: string }> = [];
    const tx = {
      safeTaxiRide: {
        findUnique: vi.fn().mockResolvedValue({
          id: "ride_1",
          passengerId: "passenger_1",
          driverId: "driver_user_1",
          paymentMethod,
          status: rideStatus,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      connectedAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: "ca_1",
          userId: connectedAccountUserId,
          integratorUserId: connectedAccountIntegratorUserId,
          status: connectedAccountStatus,
        }),
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
        updateMany: vi.fn().mockImplementation(
          (args: { where: { id: string; balance?: { gte?: bigint } }; data: { balance?: { decrement?: bigint } } }) => {
            const debit = args.data.balance?.decrement ?? 0n;
            const minBalance = args.where.balance?.gte ?? 0n;
            if (args.where.id === "w_passenger" && passengerBalance >= minBalance) {
              return Promise.resolve({ count: 1 });
            }
            void debit;
            return Promise.resolve({ count: 0 });
          },
        ),
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
        findUnique: vi.fn().mockResolvedValue(
          rideStatus === SafeTaxiRideStatus.SETTLED
            ? {
                id: "ride_1",
                status: SafeTaxiRideStatus.SETTLED,
                driverId: "driver_user_1",
              }
            : null,
        ),
      },
      connectedAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: "ca_1",
          userId: connectedAccountUserId,
          integratorUserId: connectedAccountIntegratorUserId,
          status: connectedAccountStatus,
        }),
      },
      transaction: {
        findUnique: vi.fn().mockResolvedValue(
          rideStatus === SafeTaxiRideStatus.SETTLED
            ? { id: "tx_debit", referenceId: "ride:ride_1:debit" }
            : null,
        ),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;

    return { prisma, tx, createdTransactions };
  }

  function makeRedis(setResult: "OK" | null = "OK", state: string | null = null): Redis {
    return {
      ping: vi.fn().mockResolvedValue("PONG"),
      set: vi.fn().mockResolvedValue(setResult),
      get: vi.fn().mockResolvedValue(state),
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
    expect(createdTransactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          referenceId: "ride:ride_1:debit",
          amount: -1050n,
        }),
        expect.objectContaining({ referenceId: "ride:ride_1:driver" }),
        expect.objectContaining({ referenceId: "ride:ride_1:platform" }),
        expect.objectContaining({ referenceId: "ride:ride_1:tip" }),
      ]),
    );
    vi.unstubAllEnvs();
  });

  it("200 duplicate:true tylko gdy Redis done i DB potwierdza durable settlement", async () => {
    const { prisma } = buildContext({ rideStatus: SafeTaxiRideStatus.SETTLED });
    const { app } = createApp({ prisma, redis: makeRedis(null, "done"), wsService: makeWs() });
    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ duplicate: true, rideId: "ride_1" });
  });

  it("409 dla duplicate:true gdy durable settlement należy do innego integratora", async () => {
    const { prisma } = buildContext({
      rideStatus: SafeTaxiRideStatus.SETTLED,
      connectedAccountIntegratorUserId: "integrator_other",
    });
    const { app } = createApp({ prisma, redis: makeRedis(null, "done"), wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "IDEMPOTENCY_PENDING" });
  });

  it("409 dla duplikatu bez durable settlement zamiast fałszywego sukcesu", async () => {
    const { prisma } = buildContext();
    const { app } = createApp({ prisma, redis: makeRedis(null, "processing"), wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "IDEMPOTENCY_PENDING" });
  });

  it("usuwa Redis reservation po błędzie finalize, żeby retry nie ginął", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma } = buildContext({ passengerBalance: 0n });
    const redis = makeRedis("OK");
    const { app } = createApp({ prisma, redis, wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(402);
    expect(redis.del).toHaveBeenCalledWith("idemp:ride-finalize:ride_1");
    vi.unstubAllEnvs();
  });

  it("402 gdy portfel pasażera nie pokrywa base + tip; bez kredytów", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, tx, createdTransactions } = buildContext({ passengerBalance: 1000n });
    const { app } = createApp({ prisma, redis: makeRedis("OK"), wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(402);
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(createdTransactions).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("409 gdy przejazd był już rozliczony inną ścieżką", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, createdTransactions } = buildContext({
      rideStatus: SafeTaxiRideStatus.SETTLED,
    });
    const { app } = createApp({ prisma, redis: makeRedis("OK"), wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(409);
    expect(createdTransactions).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("409 gdy przejazd nie jest CARD", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, createdTransactions } = buildContext({
      paymentMethod: RidePaymentMethod.CASH,
    });
    const { app } = createApp({ prisma, redis: makeRedis("OK"), wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(409);
    expect(createdTransactions).toEqual([]);
    vi.unstubAllEnvs();
  });
});
