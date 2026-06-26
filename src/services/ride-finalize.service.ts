import {
  ConnectedAccountStatus,
  Prisma,
  RidePaymentMethod,
  SafeTaxiRideStatus,
  TransactionType as TxType,
  type PrismaClient,
} from "@prisma/client";
import type { Request } from "express";
import { AuditActorType } from "@prisma/client";
import type { AuditLogService } from "./audit-log.service.js";
import { confirmFinalizedRide } from "./ride-finalize-confirmation.js";

export type RideFinalizeInput = {
  rideId: string;
  baseAmountGrosze: number;
  platformCommissionGrosze: number;
  driverBasePayoutGrosze: number;
  tipAmountGrosze: number;
  tipSettlement: string;
  passengerRatingStars?: number;
  driverConnectedAccountId: string;
};

export type RideFinalizeResult = {
  rideId: string;
  driverPayout: number;
  platformCommission: number;
  tip: number;
};

export class RideFinalizeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RideFinalizeConfigError";
  }
}

export class RideFinalizeNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RideFinalizeNotFoundError";
  }
}

export class RideFinalizeAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RideFinalizeAuthorizationError";
  }
}

export class RideFinalizeInvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RideFinalizeInvalidStateError";
  }
}

export class RideFinalizeInsufficientFundsError extends Error {
  constructor() {
    super("Niewystarczające środki u pasażera.");
    this.name = "RideFinalizeInsufficientFundsError";
  }
}

function platformUserIdFromEnv(): string {
  const value = process.env.SAFE_TAXI_PLATFORM_USER_ID?.trim();
  if (value === undefined || value.length === 0) {
    throw new RideFinalizeConfigError("Brak SAFE_TAXI_PLATFORM_USER_ID.");
  }
  return value;
}

export class RideFinalizeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditLogService?: AuditLogService,
  ) {}

  async confirmFinalizedRide(
    input: RideFinalizeInput,
    integratorUserId: string,
  ): Promise<RideFinalizeResult | null> {
    return confirmFinalizedRide(this.prisma, input, integratorUserId);
  }

  async finalizeRide(input: RideFinalizeInput, req?: Request): Promise<RideFinalizeResult> {
    const platformUserId = platformUserIdFromEnv();
    const rideId = input.rideId.trim();
    const integratorUserId = req?.user?.id?.trim();
    if (integratorUserId === undefined || integratorUserId.length === 0) {
      throw new RideFinalizeAuthorizationError("Brak kontekstu integratora.");
    }

    return this.prisma.$transaction(
      async (tx) => {
        const ride = await tx.safeTaxiRide.findUnique({
          where: { id: rideId },
          select: {
            id: true,
            passengerId: true,
            driverId: true,
            paymentMethod: true,
            status: true,
          },
        });
        if (ride === null) {
          throw new RideFinalizeNotFoundError("Nie znaleziono przejazdu.");
        }
        if (ride.status !== SafeTaxiRideStatus.CREATED) {
          throw new RideFinalizeInvalidStateError("Przejazd nie oczekuje na rozliczenie.");
        }
        if (ride.paymentMethod !== RidePaymentMethod.CARD) {
          throw new RideFinalizeInvalidStateError("Ride-finalize obsługuje wyłącznie przejazdy CARD.");
        }

        const connectedAccount = await tx.connectedAccount.findUnique({
          where: { id: input.driverConnectedAccountId },
          select: { id: true, userId: true, integratorUserId: true, status: true },
        });
        if (connectedAccount === null || connectedAccount.userId === null) {
          throw new RideFinalizeNotFoundError("Nie znaleziono aktywnego subkonta kierowcy.");
        }
        if (
          connectedAccount.status !== ConnectedAccountStatus.ACTIVE ||
          connectedAccount.integratorUserId !== integratorUserId ||
          connectedAccount.userId !== ride.driverId
        ) {
          throw new RideFinalizeAuthorizationError("Subkonto kierowcy nie jest uprawnione do tego przejazdu.");
        }

        const [passengerWallet, driverWallet, platformWallet] = await Promise.all([
          tx.wallet.findUnique({
            where: { userId: ride.passengerId },
            select: { id: true },
          }),
          tx.wallet.findUnique({
            where: { userId: connectedAccount.userId },
            select: { id: true },
          }),
          tx.wallet.findUnique({
            where: { userId: platformUserId },
            select: { id: true },
          }),
        ]);

        if (passengerWallet === null || driverWallet === null || platformWallet === null) {
          throw new RideFinalizeNotFoundError("Brak wymaganego portfela (pasażer/kierowca/platforma).");
        }

        const baseAmount = BigInt(input.baseAmountGrosze);
        const driverAmount = BigInt(input.driverBasePayoutGrosze);
        const platformAmount = BigInt(input.platformCommissionGrosze);
        const tipAmount = BigInt(input.tipAmountGrosze);
        const passengerDebitAmount = baseAmount + tipAmount;

        const passengerDebit = await tx.wallet.updateMany({
          where: { id: passengerWallet.id, balance: { gte: passengerDebitAmount } },
          data: { balance: { decrement: passengerDebitAmount } },
        });
        if (passengerDebit.count !== 1) {
          throw new RideFinalizeInsufficientFundsError();
        }
        await tx.transaction.create({
          data: {
            walletId: passengerWallet.id,
            amount: -passengerDebitAmount,
            referenceId: `ride:${rideId}:debit`,
            type: TxType.SAFE_TAXI_PASSENGER_CHARGE,
          },
        });

        await tx.wallet.update({
          where: { id: driverWallet.id },
          data: { balance: { increment: driverAmount } },
        });
        await tx.transaction.create({
          data: {
            walletId: driverWallet.id,
            amount: driverAmount,
            referenceId: `ride:${rideId}:driver`,
            type: TxType.SAFE_TAXI_DRIVER_PAYOUT,
          },
        });

        await tx.wallet.update({
          where: { id: platformWallet.id },
          data: { balance: { increment: platformAmount } },
        });
        await tx.transaction.create({
          data: {
            walletId: platformWallet.id,
            amount: platformAmount,
            referenceId: `ride:${rideId}:platform`,
            type: TxType.SAFE_TAXI_PLATFORM_FEE,
          },
        });

        if (tipAmount > 0n) {
          await tx.wallet.update({
            where: { id: driverWallet.id },
            data: { balance: { increment: tipAmount } },
          });
          await tx.transaction.create({
            data: {
              walletId: driverWallet.id,
              amount: tipAmount,
              referenceId: `ride:${rideId}:tip`,
              type: "TIP_CREDIT" as unknown as TxType,
            },
          });
        }

        await tx.safeTaxiRide.update({
          where: { id: rideId },
          data: {
            status: SafeTaxiRideStatus.SETTLED,
            fareCents: baseAmount,
            platformCommissionCents: platformAmount,
            driverPayoutCents: driverAmount,
            settledAt: new Date(),
          },
        });

        if (this.auditLogService !== undefined) {
          await this.auditLogService.log(
            tx,
            {
              actorId: req?.user?.id ?? null,
              actorType: AuditActorType.USER,
              action: "RIDE_FINALIZED" as never,
              entityType: "SafeTaxiRide",
              entityId: rideId,
              metadata: {
                driverConnectedAccountId: connectedAccount.id,
                driverPayoutGrosze: input.driverBasePayoutGrosze,
                platformCommissionGrosze: input.platformCommissionGrosze,
                tipAmountGrosze: input.tipAmountGrosze,
                tipSettlement: input.tipSettlement,
                passengerRatingStars: input.passengerRatingStars ?? null,
              },
            },
            req,
          );
        }

        await tx.webhookOutbox.create({
          data: {
            integratorUserId: connectedAccount.integratorUserId,
            eventType: "ride.finalized",
            payload: {
              rideId,
              driverPayout: input.driverBasePayoutGrosze,
              platformCommission: input.platformCommissionGrosze,
              tip: input.tipAmountGrosze,
            },
          },
        });

        return {
          rideId,
          driverPayout: input.driverBasePayoutGrosze + input.tipAmountGrosze,
          platformCommission: input.platformCommissionGrosze,
          tip: input.tipAmountGrosze,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 15000,
      },
    );
  }
}
