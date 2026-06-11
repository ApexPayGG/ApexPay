import { ConnectedAccountStatus, Prisma, SafeTaxiRideStatus, TransactionType as TxType, } from "@prisma/client";
import { AuditActorType } from "@prisma/client";
import { findDurableRideFinalizeDuplicateInTx } from "./ride-finalize-duplicate.service.js";
import { InsufficientFundsError } from "./wallet.service.js";
export class RideFinalizeConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = "RideFinalizeConfigError";
    }
}
export class RideFinalizeNotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = "RideFinalizeNotFoundError";
    }
}
export class RideFinalizeForbiddenError extends Error {
    constructor(message) {
        super(message);
        this.name = "RideFinalizeForbiddenError";
    }
}
export class RideFinalizeInvalidStateError extends Error {
    constructor(message) {
        super(message);
        this.name = "RideFinalizeInvalidStateError";
    }
}
function platformUserIdFromEnv() {
    const value = process.env.SAFE_TAXI_PLATFORM_USER_ID?.trim();
    if (value === undefined || value.length === 0) {
        throw new RideFinalizeConfigError("Brak SAFE_TAXI_PLATFORM_USER_ID.");
    }
    return value;
}
export class RideFinalizeService {
    prisma;
    auditLogService;
    constructor(prisma, auditLogService) {
        this.prisma = prisma;
        this.auditLogService = auditLogService;
    }
    async finalizeRide(input, req) {
        const platformUserId = platformUserIdFromEnv();
        const rideId = input.rideId.trim();
        return this.prisma.$transaction(async (tx) => {
            const ride = await tx.safeTaxiRide.findUnique({
                where: { id: rideId },
                select: {
                    id: true,
                    passengerId: true,
                    driverId: true,
                    status: true,
                    platformCommissionCents: true,
                    driverPayoutCents: true,
                },
            });
            if (ride === null) {
                throw new RideFinalizeNotFoundError("Nie znaleziono przejazdu.");
            }
            if (ride.status === SafeTaxiRideStatus.SETTLED) {
                const duplicate = await findDurableRideFinalizeDuplicateInTx(tx, {
                    rideId,
                    driverConnectedAccountId: input.driverConnectedAccountId,
                    integratorUserId: input.integratorUserId,
                });
                if (duplicate !== null) {
                    return duplicate;
                }
                throw new RideFinalizeInvalidStateError("Przejazd ma niespójny stan rozliczenia.");
            }
            if (ride.status !== SafeTaxiRideStatus.CREATED) {
                throw new RideFinalizeInvalidStateError("Przejazd nie oczekuje na rozliczenie.");
            }
            const connectedAccount = await tx.connectedAccount.findUnique({
                where: { id: input.driverConnectedAccountId },
                select: { id: true, userId: true, integratorUserId: true, status: true },
            });
            if (connectedAccount === null ||
                connectedAccount.userId === null ||
                connectedAccount.status !== ConnectedAccountStatus.ACTIVE) {
                throw new RideFinalizeNotFoundError("Nie znaleziono aktywnego subkonta kierowcy.");
            }
            if (connectedAccount.integratorUserId !== input.integratorUserId) {
                throw new RideFinalizeForbiddenError("Subkonto kierowcy nie należy do integratora.");
            }
            if (connectedAccount.userId !== ride.driverId) {
                throw new RideFinalizeForbiddenError("Subkonto nie należy do kierowcy przejazdu.");
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
                        type: "TIP_CREDIT",
                    },
                });
            }
            if (this.auditLogService !== undefined) {
                await this.auditLogService.log(tx, {
                    actorId: req?.user?.id ?? null,
                    actorType: AuditActorType.USER,
                    action: "RIDE_FINALIZED",
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
                }, req);
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
            await tx.safeTaxiRide.update({
                where: { id: rideId },
                data: {
                    status: SafeTaxiRideStatus.SETTLED,
                    fareCents: passengerDebitAmount,
                    platformCommissionCents: platformAmount,
                    driverPayoutCents: driverAmount + tipAmount,
                    settledAt: new Date(),
                },
            });
            return {
                rideId,
                driverPayout: input.driverBasePayoutGrosze + input.tipAmountGrosze,
                platformCommission: input.platformCommissionGrosze,
                tip: input.tipAmountGrosze,
                idempotent: false,
            };
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5000,
            timeout: 15000,
        });
    }
}
//# sourceMappingURL=ride-finalize.service.js.map