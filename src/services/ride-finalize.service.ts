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
import { InsufficientFundsError } from "./wallet.service.js";

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

export class RideFinalizeInvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RideFinalizeInvalidStateError";
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

  async hasDurableFinalization(params: {
    rideId: string;
    driverConnectedAccountId: string;
    integratorUserId: string;
  }): Promise<boolean> {
    const id = params.rideId.trim();
    const connectedAccountId = params.driverConnectedAccountId.trim();
    const integratorUserId = params.integratorUserId.trim();
    if (id.length === 0 || connectedAccountId.length === 0 || integratorUserId.length === 0) {
      return false;
    }

    const [ride, connectedAccount, debit] = await Promise.all([
      this.prisma.safeTaxiRide.findUnique({
        where: { id },
        select: { status: true, driverId: true },
      }),
      this.prisma.connectedAccount.findUnique({
        where: { id: connectedAccountId },
        select: { userId: true, integratorUserId: true, status: true },
      }),
      this.prisma.transaction.findUnique({
        where: { referenceId: `ride:${id}:debit` },
        select: { id: true },
      }),
    ]);

    return (
      ride?.status === SafeTaxiRideStatus.SETTLED &&
      connectedAccount !== null &&
      connectedAccount.status === ConnectedAccountStatus.ACTIVE &&
      connectedAccount.integratorUserId === integratorUserId &&
      connectedAccount.userId === ride.driverId &&
      debit !== null
    );
  }

  async finalizeRide(input: RideFinalizeInput, req?: Request): Promise<RideFinalizeResult> {
    const platformUserId = platformUserIdFromEnv();
    const rideId = input.rideId.trim();
    const integratorUserId = req?.user?.id?.trim();
    if (integratorUserId === undefined || integratorUserId.length === 0) {
      throw new RideFinalizeNotFoundError("Nie znaleziono integratora.");
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
          throw new RideFinalizeInvalidStateError("Ride finalize obsługuje tylko przejazdy CARD.");
        }

        const connectedAccount = await tx.connectedAccount.findUnique({
          where: { id: input.driverConnectedAccountId },
          select: { id: true, userId: true, integratorUserId: true, status: true },
        });
        if (
          connectedAccount === null ||
          connectedAccount.userId === null ||
          connectedAccount.status !== ConnectedAccountStatus.ACTIVE ||
          connectedAccount.integratorUserId !== integratorUserId ||
          connectedAccount.userId !== ride.driverId
        ) {
          throw new RideFinalizeNotFoundError("Nie znaleziono aktywnego subkonta kierowcy.");
        }

        const [passengerWallet, driverWallet, platformWallet] = await Promise.all([
          tx.wallet.findUnique({
            where: { userId: ride.passengerId },
            select: { id: true, balance: true },
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
          throw new InsufficientFundsError();
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
              type: TxType.TIP_CREDIT,
            },
          });
        }

        await tx.safeTaxiRide.update({
          where: { id: rideId },
          data: {
            status: SafeTaxiRideStatus.SETTLED,
            fareCents: baseAmount,
            platformCommissionCents: platformAmount,
            driverPayoutCents: driverAmount + tipAmount,
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
