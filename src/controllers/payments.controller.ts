import type { Request, Response } from "express";
import { ConnectedAccountStatus, SafeTaxiRideStatus, type PrismaClient } from "@prisma/client";
import { z, ZodError } from "zod";
import type { Redis } from "ioredis";
import { AutopayService } from "../services/autopay.service.js";
import {
  RideFinalizeAuthorizationError,
  RideFinalizeConfigError,
  RideFinalizeInvalidStateError,
  RideFinalizeNotFoundError,
  RideFinalizeService,
} from "../services/ride-finalize.service.js";
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

export class PaymentsController {
  constructor(
    private readonly autopayService: AutopayService,
    private readonly prisma: PrismaClient,
    private readonly rideFinalizeService: RideFinalizeService,
    private readonly redis: Redis,
  ) {}

  private async hasCompletedRideFinalize(
    rideId: string,
    driverConnectedAccountId: string,
    integratorUserId: string,
  ): Promise<boolean> {
    const [ride, passengerDebit, connectedAccount] = await Promise.all([
      this.prisma.safeTaxiRide.findUnique({
        where: { id: rideId },
        select: { status: true, driverId: true },
      }),
      this.prisma.transaction.findUnique({
        where: { referenceId: `ride:${rideId}:debit` },
        select: { id: true },
      }),
      this.prisma.connectedAccount.findUnique({
        where: { id: driverConnectedAccountId },
        select: { userId: true, integratorUserId: true, status: true },
      }),
    ]);
    if (ride?.status !== SafeTaxiRideStatus.SETTLED || passengerDebit === null) {
      return false;
    }
    if (
      connectedAccount === null ||
      connectedAccount.userId === null ||
      connectedAccount.status !== ConnectedAccountStatus.ACTIVE
    ) {
      throw new RideFinalizeNotFoundError("Nie znaleziono aktywnego subkonta kierowcy.");
    }
    if (connectedAccount.integratorUserId !== integratorUserId) {
      throw new RideFinalizeAuthorizationError("Subkonto nie należy do tego integratora.");
    }
    if (connectedAccount.userId !== ride.driverId) {
      throw new RideFinalizeAuthorizationError("Subkonto nie należy do kierowcy tego przejazdu.");
    }
    return true;
  }

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

    let reservedIdempotencyKey: string | undefined;
    try {
      const body = rideFinalizeBodySchema.parse(req.body);
      if (body.platform_commission_grosze + body.driver_base_payout_grosze !== body.base_amount_grosze) {
        res.status(400).json({
          error:
            "Nieprawidłowy split: platform_commission_grosze + driver_base_payout_grosze musi równać się base_amount_grosze.",
          code: "BAD_REQUEST",
        });
        return;
      }

      const idempotencyKey = `idemp:ride-finalize:${body.ride_id}`;
      const idemSet = await this.redis.set(idempotencyKey, "processing", "EX", 86400, "NX");
      if (idemSet === null) {
        if (!(await this.hasCompletedRideFinalize(body.ride_id, body.driver_connected_account_id, userId))) {
          res.status(409).json({
            error: "Rozliczenie przejazdu jest w toku albo nie zostało trwale zakończone.",
            code: "CONFLICT",
          });
          return;
        }
        res.status(200).json({
          rideId: body.ride_id,
          duplicate: true,
        });
        return;
      }
      reservedIdempotencyKey = idempotencyKey;

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
      reservedIdempotencyKey = undefined;
      try {
        await this.redis.set(idempotencyKey, "done", "EX", 86400);
      } catch (redisErr) {
        console.error("[payments/ride-finalize] failed to mark idempotency done", redisErr);
      }

      res.status(201).json({
        rideId: result.rideId,
        driverPayout: result.driverPayout,
        platformCommission: result.platformCommission,
        tip: result.tip,
        duplicate: false,
      });
    } catch (err) {
      if (reservedIdempotencyKey !== undefined) {
        try {
          await this.redis.del(reservedIdempotencyKey);
        } catch (redisErr) {
          console.error("[payments/ride-finalize] failed to release idempotency key", redisErr);
        }
      }
      if (err instanceof ZodError) {
        res.status(400).json({ error: "Nieprawidłowe dane.", code: "BAD_REQUEST" });
        return;
      }
      if (err instanceof RideFinalizeNotFoundError) {
        res.status(404).json({ error: err.message, code: "NOT_FOUND" });
        return;
      }
      if (err instanceof RideFinalizeConfigError) {
        res.status(503).json({ error: err.message, code: "SERVICE_UNAVAILABLE" });
        return;
      }
      if (err instanceof RideFinalizeAuthorizationError) {
        res.status(403).json({ error: err.message, code: "FORBIDDEN" });
        return;
      }
      if (err instanceof RideFinalizeInvalidStateError) {
        res.status(409).json({ error: err.message, code: "CONFLICT" });
        return;
      }
      if (err instanceof InsufficientFundsError) {
        res.status(402).json({ error: "Niewystarczające środki.", code: "PAYMENT_REQUIRED" });
        return;
      }
      console.error("[payments/ride-finalize]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
}
