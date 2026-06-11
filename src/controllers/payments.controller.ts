import type { Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z, ZodError } from "zod";
import type { Redis } from "ioredis";
import { AutopayService } from "../services/autopay.service.js";
import {
  RideFinalizeConfigError,
  RideFinalizeForbiddenError,
  RideFinalizeInvalidStateError,
  RideFinalizeNotFoundError,
  RideFinalizeService,
} from "../services/ride-finalize.service.js";
import { findDurableRideFinalizeDuplicate } from "../services/ride-finalize-duplicate.service.js";
import { InsufficientFundsError } from "../services/wallet.service.js";

const bodySchema = z
  .object({
    amount: z.number().int().positive(),
    currency: z.string().trim().min(1).max(8).default("PLN"),
    description: z.string().trim().min(1).max(255),
  })
  .strict();

const rideFinalizeBodySchema = z
  .object({
    ride_id: z.string().trim().min(1),
    base_amount_grosze: z.number().int().positive(),
    platform_commission_grosze: z.number().int().min(0),
    driver_base_payout_grosze: z.number().int().min(0),
    tip_amount_grosze: z.number().int().min(0).default(0),
    tip_settlement: z.string().trim().min(1).default("CREDIT_CONNECTED_ACCOUNT"),
    passenger_rating_stars: z.number().int().min(1).max(5).optional(),
    driver_connected_account_id: z.string().trim().min(1),
  })
  .strict();

function isAutopayConfigError(err: unknown): boolean {
  return err instanceof Error && /AUTOPAY_[A-Z_]+\s+is required/.test(err.message);
}

function safeIntegerSum(...values: number[]): number | null {
  const total = values.reduce((acc, value) => acc + value, 0);
  return Number.isSafeInteger(total) ? total : null;
}

export class PaymentsController {
  constructor(
    private readonly autopayService: AutopayService,
    private readonly prisma: PrismaClient,
    private readonly rideFinalizeService: RideFinalizeService,
    private readonly redis: Redis,
  ) {}

  async initiate(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id?.trim();
    if (userId === undefined || userId.length === 0) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    try {
      const body = bodySchema.parse(req.body);
      const amountMajor = (body.amount / 100).toFixed(2);
      const orderId = `dep:${userId}:${Date.now()}`;
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (user === null) {
        res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
        return;
      }

      const paymentUrl = this.autopayService.createPaymentLink({
        orderId,
        amount: amountMajor,
        currency: body.currency.toUpperCase(),
        customerEmail: user.email,
        description: body.description,
      });

      res.status(200).json({
        status: "success",
        data: { paymentUrl, orderId },
      });
    } catch (err) {
      if (err instanceof ZodError || err instanceof RangeError) {
        res.status(400).json({ error: "Nieprawidłowe dane.", code: "BAD_REQUEST" });
        return;
      }
      if (isAutopayConfigError(err)) {
        res.status(503).json({
          error: "Brak konfiguracji Autopay na serwerze.",
          code: "AUTOPAY_NOT_CONFIGURED",
        });
        return;
      }
      console.error("[payments/initiate]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  async rideFinalize(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id?.trim();
    if (userId === undefined || userId.length === 0) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    let idempotencyKey: string | undefined;
    let reservationCreated = false;
    let settlementCommitted = false;

    try {
      const body = rideFinalizeBodySchema.parse(req.body);
      const splitTotal = safeIntegerSum(
        body.platform_commission_grosze,
        body.driver_base_payout_grosze,
      );
      const passengerTotal = safeIntegerSum(body.base_amount_grosze, body.tip_amount_grosze);
      const driverTotal = safeIntegerSum(
        body.driver_base_payout_grosze,
        body.tip_amount_grosze,
      );
      if (splitTotal === null || splitTotal !== body.base_amount_grosze) {
        res.status(400).json({
          error:
            "Nieprawidłowy split: platform_commission_grosze + driver_base_payout_grosze musi równać się base_amount_grosze.",
          code: "BAD_REQUEST",
        });
        return;
      }
      if (passengerTotal === null || driverTotal === null) {
        res.status(400).json({
          error: "Suma kwot rozliczenia przekracza bezpieczny zakres.",
          code: "BAD_REQUEST",
        });
        return;
      }

      idempotencyKey = `idemp:ride-finalize:${body.ride_id}`;
      const idemSet = await this.redis.set(idempotencyKey, "processing", "EX", 86400, "NX");
      if (idemSet === null) {
        const duplicate = await findDurableRideFinalizeDuplicate(this.prisma, {
          rideId: body.ride_id,
          driverConnectedAccountId: body.driver_connected_account_id,
          integratorUserId: userId,
        });
        if (duplicate === null) {
          res.status(409).json({
            error: "Rozliczenie przejazdu jest w toku albo poprzednia próba nie została utrwalona.",
            code: "CONFLICT",
          });
          return;
        }
        res.status(200).json({
          rideId: duplicate.rideId,
          driverPayout: duplicate.driverPayout,
          platformCommission: duplicate.platformCommission,
          tip: duplicate.tip,
          duplicate: true,
        });
        return;
      }
      reservationCreated = true;

      const finalizeInput = {
        rideId: body.ride_id,
        baseAmountGrosze: body.base_amount_grosze,
        platformCommissionGrosze: body.platform_commission_grosze,
        driverBasePayoutGrosze: body.driver_base_payout_grosze,
        tipAmountGrosze: body.tip_amount_grosze,
        tipSettlement: body.tip_settlement,
        driverConnectedAccountId: body.driver_connected_account_id,
        integratorUserId: userId,
        ...(body.passenger_rating_stars !== undefined
          ? { passengerRatingStars: body.passenger_rating_stars }
          : {}),
      };
      const result = await this.rideFinalizeService.finalizeRide(finalizeInput, req);
      settlementCommitted = true;
      await this.redis.set(idempotencyKey, "done", "EX", 86400).catch((err: unknown) => {
        console.error("[payments/ride-finalize] redis done marker failed", err);
      });

      res.status(result.idempotent ? 200 : 201).json({
        rideId: result.rideId,
        driverPayout: result.driverPayout,
        platformCommission: result.platformCommission,
        tip: result.tip,
        duplicate: result.idempotent,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: "Nieprawidłowe dane.", code: "BAD_REQUEST" });
        return;
      }
      if (err instanceof InsufficientFundsError) {
        await this.releaseRideFinalizeReservation(idempotencyKey, reservationCreated, settlementCommitted);
        res.status(402).json({ error: "Niewystarczające środki pasażera.", code: "PAYMENT_REQUIRED" });
        return;
      }
      if (err instanceof RideFinalizeForbiddenError) {
        await this.releaseRideFinalizeReservation(idempotencyKey, reservationCreated, settlementCommitted);
        res.status(403).json({ error: err.message, code: "FORBIDDEN" });
        return;
      }
      if (err instanceof RideFinalizeInvalidStateError) {
        await this.releaseRideFinalizeReservation(idempotencyKey, reservationCreated, settlementCommitted);
        res.status(409).json({ error: err.message, code: "CONFLICT" });
        return;
      }
      if (err instanceof RideFinalizeNotFoundError) {
        await this.releaseRideFinalizeReservation(idempotencyKey, reservationCreated, settlementCommitted);
        res.status(404).json({ error: err.message, code: "NOT_FOUND" });
        return;
      }
      if (err instanceof RideFinalizeConfigError) {
        await this.releaseRideFinalizeReservation(idempotencyKey, reservationCreated, settlementCommitted);
        res.status(503).json({ error: err.message, code: "SERVICE_UNAVAILABLE" });
        return;
      }
      await this.releaseRideFinalizeReservation(idempotencyKey, reservationCreated, settlementCommitted);
      console.error("[payments/ride-finalize]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  private async releaseRideFinalizeReservation(
    idempotencyKey: string | undefined,
    reservationCreated: boolean,
    settlementCommitted: boolean,
  ): Promise<void> {
    if (!reservationCreated || settlementCommitted || idempotencyKey === undefined) {
      return;
    }
    await this.redis.del(idempotencyKey).catch((err: unknown) => {
      console.error("[payments/ride-finalize] redis reservation release failed", err);
    });
  }
}
