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
    accountIntegratorUserId?: string;
    accountUserId?: string;
    accountStatus?: ConnectedAccountStatus;
    durableDebit?: boolean;
  }) {
    const passengerBalance = opts?.passengerBalance ?? 10000n;
    const rideRow = {
      id: "ride_1",
      passengerId: "passenger_1",
      driverId: "driver_user_1",
      paymentMethod: RidePaymentMethod.CARD,
      status: opts?.rideStatus ?? SafeTaxiRideStatus.CREATED,
      fareCents: opts?.rideStatus === SafeTaxiRideStatus.SETTLED ? 1050n : null,
      platformCommissionCents:
        opts?.rideStatus === SafeTaxiRideStatus.SETTLED ? 200n : null,
      driverPayoutCents:
        opts?.rideStatus === SafeTaxiRideStatus.SETTLED ? 850n : null,
    };
    const accountRow = {
      id: "ca_1",
      userId: opts?.accountUserId ?? "driver_user_1",
      integratorUserId: opts?.accountIntegratorUserId ?? integratorUserId,
      status: opts?.accountStatus ?? ConnectedAccountStatus.ACTIVE,
    };
    const createdTransactions: Array<{ referenceId: string; amount: bigint; type: string }> = [];
    const tx = {
      safeTaxiRide: {
        findUnique: vi.fn().mockResolvedValue(rideRow),
        update: vi.fn().mockResolvedValue({}),
      },
      connectedAccount: {
        findUnique: vi.fn().mockResolvedValue(accountRow),
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
        updateMany: vi.fn().mockResolvedValue({
          count: passengerBalance >= 1050n ? 1 : 0,
        }),
      },
      transaction: {
        findUnique: vi.fn().mockImplementation(
          (args: { where: { referenceId: string } }) =>
            Promise.resolve(
              opts?.durableDebit === true &&
                args.where.referenceId === "ride:ride_1:debit"
                ? { id: "tx_debit" }
                : null,
            ),
        ),
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
        findUnique: vi.fn().mockResolvedValue(rideRow),
      },
      connectedAccount: {
        findUnique: vi.fn().mockResolvedValue(accountRow),
      },
      transaction: {
        findUnique: tx.transaction.findUnique,
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;

    return { prisma, tx, createdTransactions };
  }

  function makeRedis(setResult: "OK" | null = "OK"): Redis {
    return {
      ping: vi.fn().mockResolvedValue("PONG"),
      incr: vi.fn().mockResolvedValue(1),
      pexpire: vi.fn().mockResolvedValue(1),
      pttl: vi.fn().mockResolvedValue(60_000),
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
    const { prisma, tx, createdTransactions } = buildContext();
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
    expect(tx.wallet.updateMany).toHaveBeenCalledWith({
      where: {
        id: "w_passenger",
        balance: { gte: 1050n },
      },
      data: { balance: { decrement: 1050n } },
    });
    expect(tx.safeTaxiRide.update).toHaveBeenCalledWith({
      where: { id: "ride_1" },
      data: expect.objectContaining({
        status: SafeTaxiRideStatus.SETTLED,
        fareCents: 1050n,
      }),
    });
    vi.unstubAllEnvs();
  });

  it("200 duplicate:true tylko gdy rozliczenie istnieje trwale w bazie", async () => {
    const { prisma } = buildContext({
      rideStatus: SafeTaxiRideStatus.SETTLED,
      durableDebit: true,
    });
    const { app } = createApp({ prisma, redis: makeRedis(null), wsService: makeWs() });
    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ duplicate: true, rideId: "ride_1" });
  });

  it("409 gdy rezerwacja Redis istnieje bez trwałego rozliczenia", async () => {
    const { prisma } = buildContext();
    const { app } = createApp({ prisma, redis: makeRedis(null), wsService: makeWs() });
    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "RIDE_FINALIZE_IN_PROGRESS" });
  });

  it("402 i zero creditów gdy pasażer nie ma środków na bazę oraz napiwek", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, tx, createdTransactions } = buildContext({ passengerBalance: 1000n });
    const redis = makeRedis("OK");
    const { app } = createApp({ prisma, redis, wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(createdTransactions).toEqual([]);
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith("idemp:ride-finalize:ride_1");
    vi.unstubAllEnvs();
  });

  it("403 gdy subkonto nie należy do integratora z klucza API", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, tx } = buildContext({ accountIntegratorUserId: "other_integrator" });
    const { app } = createApp({ prisma, redis: makeRedis("OK"), wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN" });
    expect(tx.wallet.update).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
