import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { PaymentsController } from "./payments.controller.js";
import type { RideFinalizeService } from "../services/ride-finalize.service.js";
import type { AutopayService } from "../services/autopay.service.js";

function responseMock(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe("PaymentsController.rideFinalize idempotency durability", () => {
  it("nie zwalnia idempotency key gdy rozliczenie DB już się udało, ale zapis done w Redis padł", async () => {
    const redis = {
      set: vi.fn().mockImplementation((_key: string, _value: string, _ex: string, _ttl: number, mode?: string) => {
        if (mode === "NX") {
          return Promise.resolve("OK");
        }
        return Promise.reject(new Error("redis down after commit"));
      }),
      del: vi.fn(),
    } as unknown as Redis;
    const rideFinalizeService = {
      finalizeRide: vi.fn().mockResolvedValue({
        rideId: "ride_1",
        driverPayout: 850,
        platformCommission: 200,
        tip: 50,
      }),
    } as unknown as RideFinalizeService;
    const controller = new PaymentsController(
      {} as AutopayService,
      {} as PrismaClient,
      rideFinalizeService,
      redis,
    );
    const req = {
      user: { id: "integrator_1" },
      body: {
        ride_id: "ride_1",
        base_amount_grosze: 1000,
        platform_commission_grosze: 200,
        driver_base_payout_grosze: 800,
        tip_amount_grosze: 50,
        tip_settlement: "CREDIT_CONNECTED_ACCOUNT",
        driver_connected_account_id: "ca_1",
      },
    } as unknown as Request;
    const res = responseMock();

    await controller.rideFinalize(req, res);

    expect(redis.del).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ duplicate: false, rideId: "ride_1" }));
  });
});
