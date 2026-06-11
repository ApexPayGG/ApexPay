import { ConnectedAccountStatus, Prisma, SafeTaxiRideStatus, } from "@prisma/client";
export async function findDurableRideFinalizeDuplicateInTx(tx, input) {
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
    if (connectedAccount === null ||
        connectedAccount.status !== ConnectedAccountStatus.ACTIVE ||
        connectedAccount.userId !== ride.driverId ||
        connectedAccount.integratorUserId !== input.integratorUserId) {
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
export async function findDurableRideFinalizeDuplicate(prisma, input) {
    return prisma.$transaction((tx) => findDurableRideFinalizeDuplicateInTx(tx, input));
}
//# sourceMappingURL=ride-finalize-duplicate.service.js.map