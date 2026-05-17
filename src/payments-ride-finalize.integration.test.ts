import bcrypt from "bcrypt";
import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { SafeTaxiRideStatus } from "@prisma/client";
import { createApp } from "./create-app.js";
import { API_KEY_LOOKUP_PREFIX_LENGTH, API_KEY_PUBLIC_PREFIX } from "./services/api-key.service.js";
import {
  buildRideFinalizeContext,
  makeRideFinalizeRedis,
  makeRideFinalizeWs,
  rideFinalizePayload as payload,
} from "./payments-ride-finalize.test-helpers.js";

describe("POST /api/v1/payments/ride-finalize (integration)", () => {
  let fullApiKey: string;
  let keyHash: string;
  let keyPrefix: string;

  beforeAll(async () => {
    const suffix = "c".repeat(Math.max(0, API_KEY_LOOKUP_PREFIX_LENGTH - API_KEY_PUBLIC_PREFIX.length));
    fullApiKey = `${API_KEY_PUBLIC_PREFIX}${suffix}`;
    keyPrefix = fullApiKey.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH);
    keyHash = await bcrypt.hash(fullApiKey, 4);
  });

  const buildContext = (opts?: Parameters<typeof buildRideFinalizeContext>[2]) =>
    buildRideFinalizeContext(keyPrefix, keyHash, opts);
  const makeRedis = makeRideFinalizeRedis;
  const makeWs = makeRideFinalizeWs;

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
    expect(createdTransactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          referenceId: "ride:ride_1:debit",
          amount: -1050n,
        }),
      ]),
    );
    expect(tx.wallet.update).toHaveBeenCalledWith({
      where: { id: "w_passenger" },
      data: { balance: { decrement: 1050n } },
    });
    expect(tx.safeTaxiRide.update).toHaveBeenCalledWith({
      where: { id: "ride_1" },
      data: expect.objectContaining({
        status: SafeTaxiRideStatus.SETTLED,
        fareCents: 1000n,
        platformCommissionCents: 200n,
        driverPayoutCents: 800n,
      }),
    });
    vi.unstubAllEnvs();
  });

  it("200 duplicate:true dla duplikatu ride_id", async () => {
    const { prisma } = buildContext({ finalizeDebitExists: true });
    const { app } = createApp({ prisma, redis: makeRedis(null), wsService: makeWs() });
    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ duplicate: true, rideId: "ride_1" });
  });

  it("403 dla duplikatu done gdy klucz API nie należy do integratora subkonta", async () => {
    const { prisma } = buildContext({
      connectedAccountIntegratorUserId: "integrator_other",
    });
    const { app } = createApp({ prisma, redis: makeRedis(null, "done"), wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN" });
  });

  it("409 dla stalego processing gdy przejazd rozliczono bez ledgeru ride-finalize", async () => {
    const { prisma } = buildContext({
      rideStatus: SafeTaxiRideStatus.SETTLED,
      finalizeDebitExists: false,
    });
    const redis = makeRedis(null, "processing");
    const { app } = createApp({ prisma, redis, wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });
    expect(redis.set).not.toHaveBeenCalledWith("idemp:ride-finalize:ride_1", "done", "EX", 86400);
  });

  it("402 gdy saldo pasażera nie pokrywa kwoty bazowej i nie księguje wypłat", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, createdTransactions } = buildContext({ passengerBalance: 0n });
    const redis = makeRedis("OK");
    const { app } = createApp({ prisma, redis, wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(402);
    expect(createdTransactions).toEqual([]);
    expect(redis.del).toHaveBeenCalledWith("idemp:ride-finalize:ride_1");
    vi.unstubAllEnvs();
  });

  it("403 gdy subkonto kierowcy należy do innego integratora", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, createdTransactions } = buildContext({
      connectedAccountIntegratorUserId: "integrator_other",
    });
    const redis = makeRedis("OK");
    const { app } = createApp({ prisma, redis, wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(403);
    expect(createdTransactions).toEqual([]);
    expect(redis.del).toHaveBeenCalledWith("idemp:ride-finalize:ride_1");
    vi.unstubAllEnvs();
  });

  it("403 gdy subkonto nie należy do kierowcy przypisanego do przejazdu", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, createdTransactions } = buildContext({
      connectedAccountUserId: "driver_user_2",
    });
    const redis = makeRedis("OK");
    const { app } = createApp({ prisma, redis, wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(403);
    expect(createdTransactions).toEqual([]);
    expect(redis.del).toHaveBeenCalledWith("idemp:ride-finalize:ride_1");
    vi.unstubAllEnvs();
  });

  it("409 gdy przejazd został już rozliczony inną ścieżką", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "platform_1");
    const { prisma, createdTransactions } = buildContext({
      rideStatus: SafeTaxiRideStatus.SETTLED,
    });
    const redis = makeRedis("OK");
    const { app } = createApp({ prisma, redis, wsService: makeWs() });

    const res = await request(app)
      .post("/api/v1/payments/ride-finalize")
      .set("x-api-key", fullApiKey)
      .send(payload);

    expect(res.status).toBe(409);
    expect(createdTransactions).toEqual([]);
    expect(redis.del).toHaveBeenCalledWith("idemp:ride-finalize:ride_1");
    vi.unstubAllEnvs();
  });
});
