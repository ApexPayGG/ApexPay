import {
  ConnectedAccountStatus,
  SafeTaxiRideStatus,
  type PrismaClient,
} from "@prisma/client";

export type RideFinalizeConfirmationInput = {
  rideId: string;
  baseAmountGrosze: number;
  platformCommissionGrosze: number;
  driverBasePayoutGrosze: number;
  tipAmountGrosze: number;
  driverConnectedAccountId: string;
};

export type ConfirmedRideFinalizeResult = {
  rideId: string;
  driverPayout: number;
  platformCommission: number;
  tip: number;
};

export async function confirmFinalizedRide(
  prisma: PrismaClient,
  input: RideFinalizeConfirmationInput,
  integratorUserId: string,
): Promise<ConfirmedRideFinalizeResult | null> {
  const rideId = input.rideId.trim();
  const [ride, connectedAccount] = await Promise.all([
    prisma.safeTaxiRide.findUnique({
      where: { id: rideId },
      select: { id: true, driverId: true, status: true },
    }),
    prisma.connectedAccount.findUnique({
      where: { id: input.driverConnectedAccountId },
      select: { id: true, userId: true, integratorUserId: true, status: true },
    }),
  ]);

  if (
    ride === null ||
    connectedAccount === null ||
    ride.status !== SafeTaxiRideStatus.SETTLED ||
    connectedAccount.status !== ConnectedAccountStatus.ACTIVE ||
    connectedAccount.userId !== ride.driverId ||
    connectedAccount.integratorUserId !== integratorUserId
  ) {
    return null;
  }

  const [debit, driver, platform, tip] = await Promise.all([
    prisma.transaction.findUnique({
      where: { referenceId: `ride:${rideId}:debit` },
      select: { amount: true },
    }),
    prisma.transaction.findUnique({
      where: { referenceId: `ride:${rideId}:driver` },
      select: { amount: true },
    }),
    prisma.transaction.findUnique({
      where: { referenceId: `ride:${rideId}:platform` },
      select: { amount: true },
    }),
    prisma.transaction.findUnique({
      where: { referenceId: `ride:${rideId}:tip` },
      select: { amount: true },
    }),
  ]);

  if (debit === null || driver === null || platform === null) {
    return null;
  }

  const expectedTipAmount = BigInt(input.tipAmountGrosze);
  if (
    debit.amount !== -(BigInt(input.baseAmountGrosze) + expectedTipAmount) ||
    driver.amount !== BigInt(input.driverBasePayoutGrosze) ||
    platform.amount !== BigInt(input.platformCommissionGrosze) ||
    (tip?.amount ?? 0n) !== expectedTipAmount
  ) {
    return null;
  }

  const tipAmount = tip?.amount ?? 0n;
  return {
    rideId,
    driverPayout: Number(driver.amount + tipAmount),
    platformCommission: Number(platform.amount),
    tip: Number(tipAmount),
  };
}
