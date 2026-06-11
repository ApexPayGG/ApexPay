import {
  ConnectedAccountStatus,
  Prisma,
  SafeTaxiRideStatus,
  type PrismaClient,
} from "@prisma/client";
import type { RideFinalizeResult } from "./ride-finalize.service.js";

export async function findDurableRideFinalizeDuplicateInTx(
  tx: Prisma.TransactionClient,
  input: {
    rideId: string;
    driverConnectedAccountId: string;
    integratorUserId: string;
  },
): Promise<RideFinalizeResult | null> {
  const rideId = input.rideId.trim();
  const ride = await tx.safeTaxiRide.findUnique({
    where: { id: rideId },
    select: {
      id: true,
      driverId: true,
      status: true,
      platformCommissionCents: true,
      driverPayoutCents: true,
    },
  });
  if (ride === null || ride.status !== SafeTaxiRideStatus.SETTLED) {
    return null;
  }

  const connectedAccount = await tx.connectedAccount.findUnique({
    where: { id: input.driverConnectedAccountId },
    select: { userId: true, integratorUserId: true, status: true },
  });
  if (
    connectedAccount === null ||
    connectedAccount.status !== ConnectedAccountStatus.ACTIVE ||
    connectedAccount.userId !== ride.driverId ||
    connectedAccount.integratorUserId !== input.integratorUserId
  ) {
    return null;
  }

  const [passengerDebit, tipCredit] = await Promise.all([
    tx.transaction.findUnique({
      where: { referenceId: `ride:${rideId}:debit` },
      select: { id: true },
    }),
    tx.transaction.findUnique({
      where: { referenceId: `ride:${rideId}:tip` },
      select: { amount: true },
    }),
  ]);
  if (passengerDebit === null) {
    return null;
  }

  return {
    rideId,
    driverPayout: Number(ride.driverPayoutCents ?? 0n),
    platformCommission: Number(ride.platformCommissionCents ?? 0n),
    tip: Number(tipCredit?.amount ?? 0n),
    idempotent: true,
  };
}

export async function findDurableRideFinalizeDuplicate(
  prisma: PrismaClient,
  input: {
    rideId: string;
    driverConnectedAccountId: string;
    integratorUserId: string;
  },
): Promise<RideFinalizeResult | null> {
  return prisma.$transaction((tx) => findDurableRideFinalizeDuplicateInTx(tx, input));
}
