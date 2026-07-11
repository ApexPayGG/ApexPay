import {
  ConnectedAccountStatus,
  Prisma,
  RidePaymentMethod,
  SafeTaxiRideStatus,
  type PrismaClient,
} from "@prisma/client";
import type {
  RideFinalizeInput,
  RideFinalizeResult,
} from "./ride-finalize.service.js";

export async function confirmRideFinalized(
  prisma: PrismaClient,
  input: RideFinalizeInput,
  integratorUserId: string,
): Promise<RideFinalizeResult | null> {
  const rideId = input.rideId.trim();
  const passengerCharge = BigInt(input.baseAmountGrosze + input.tipAmountGrosze);

  return prisma.$transaction(
    async (tx) => {
      const ride = await tx.safeTaxiRide.findUnique({
        where: { id: rideId },
        select: { driverId: true, paymentMethod: true, status: true },
      });
      if (
        ride === null ||
        ride.paymentMethod !== RidePaymentMethod.CARD ||
        ride.status !== SafeTaxiRideStatus.SETTLED
      ) {
        return null;
      }

      const account = await tx.connectedAccount.findUnique({
        where: { id: input.driverConnectedAccountId },
        select: {
          integratorUserId: true,
          status: true,
          userId: true,
        },
      });
      if (
        account === null ||
        account.status !== ConnectedAccountStatus.ACTIVE ||
        account.userId !== ride.driverId ||
        account.integratorUserId !== integratorUserId
      ) {
        return null;
      }

      const debit = await tx.transaction.findUnique({
        where: { referenceId: `ride:${rideId}:debit` },
        select: { amount: true },
      });
      if (debit === null || debit.amount !== -passengerCharge) {
        return null;
      }

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
      timeout: 10000,
    },
  );
}
