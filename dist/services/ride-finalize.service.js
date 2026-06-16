import { ConnectedAccountStatus, Prisma, RidePaymentMethod, SafeTaxiRideStatus, TransactionType as TxType, } from "@prisma/client";
import { AuditActorType } from "@prisma/client";
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
export class RideFinalizeAuthorizationError extends Error {
    constructor(message) {
        super(message);
        this.name = "RideFinalizeAuthorizationError";
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
        const integratorUserId = req?.user?.id?.trim();
        if (integratorUserId === undefined || integratorUserId.length === 0) {
            throw new RideFinalizeAuthorizationError("Brak kontekstu integratora API.");
        }
        return this.prisma.$transaction(async (tx) => {
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
            if (ride.paymentMethod !== RidePaymentMethod.CARD || ride.status !== SafeTaxiRideStatus.CREATED) {
                throw new RideFinalizeInvalidStateError("Przejazd nie jest gotowy do finalizacji CARD.");
            }
            const connectedAccount = await tx.connectedAccount.findUnique({
                where: { id: input.driverConnectedAccountId },
                select: { id: true, userId: true, integratorUserId: true, status: true },
            });
            if (connectedAccount === null || connectedAccount.userId === null) {
                throw new RideFinalizeNotFoundError("Nie znaleziono aktywnego subkonta kierowcy.");
            }
            if (connectedAccount.userId !== ride.driverId ||
                connectedAccount.integratorUserId !== integratorUserId ||
                connectedAccount.status !== ConnectedAccountStatus.ACTIVE) {
                throw new RideFinalizeAuthorizationError("Subkonto kierowcy nie jest powiązane z tym integratorem i przejazdem.");
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
            const debit = await tx.wallet.updateMany({
                where: { id: passengerWallet.id, balance: { gte: baseAmount } },
                data: { balance: { decrement: baseAmount } },
            });
            if (debit.count !== 1) {
                throw new InsufficientFundsError();
            }
            await tx.transaction.create({
                data: {
                    walletId: passengerWallet.id,
                    amount: -baseAmount,
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
            return {
                rideId,
                driverPayout: input.driverBasePayoutGrosze + input.tipAmountGrosze,
                platformCommission: input.platformCommissionGrosze,
                tip: input.tipAmountGrosze,
            };
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5000,
            timeout: 15000,
        });
    }
}
//# sourceMappingURL=ride-finalize.service.js.map