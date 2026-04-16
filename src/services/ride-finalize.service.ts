import { Prisma, TransactionType as TxType, type PrismaClient } from "@prisma/client";
import type { Request } from "express";
import { AuditActorType } from "@prisma/client";
import type { AuditLogService } from "./audit-log.service.js";

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

  async finalizeRide(input: RideFinalizeInput, req?: Request): Promise<RideFinalizeResult> {
    const platformUserId = platformUserIdFromEnv();
    const rideId = input.rideId.trim();

    return this.prisma.$transaction(
      async (tx) => {
        const ride = await tx.safeTaxiRide.findUnique({
          where: { id: rideId },
          select: { id: true, passengerId: true },
        });
        if (ride === null) {
          throw new RideFinalizeNotFoundError("Nie znaleziono przejazdu.");
        }

        const connectedAccount = await tx.connectedAccount.findUnique({
          where: { id: input.driverConnectedAccountId },
          select: { id: true, userId: true, integratorUserId: true },
        });
        if (connectedAccount === null || connectedAccount.userId === null) {
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

        // Jeśli saldo pasażera nie pokrywa kwoty, zakładamy że pay-in był już zaksięgowany poza tym krokiem.
        if (passengerWallet.balance >= baseAmount) {
          await tx.wallet.update({
            where: { id: passengerWallet.id },
            data: { balance: { decrement: baseAmount } },
          });
          await tx.transaction.create({
            data: {
              walletId: passengerWallet.id,
              amount: -baseAmount,
              referenceId: `ride:${rideId}:debit`,
              type: TxType.SAFE_TAXI_PASSENGER_CHARGE,
            },
          });
        }

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
