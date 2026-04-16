import { type PrismaClient, RidePaymentMethod } from "@prisma/client";
export declare class SafeTaxiConfigError extends Error {
    constructor(message: string);
}
export declare class SafeTaxiRideNotFoundError extends Error {
    constructor();
}
export declare class SafeTaxiInvalidStateError extends Error {
    constructor(message: string);
}
/** Przekroczono dozwolone zadłużenie portfela kierowcy (gotówka / prowizja). */
export declare class DriverDebtLimitExceededError extends Error {
    constructor();
}
/** Podział taryfy (grosze) — prowizja platformy w basis points (0–10000). */
export declare function splitSafeTaxiFare(fareCents: bigint, commissionBps: bigint): {
    platformCents: bigint;
    driverCents: bigint;
};
/** Rozliczenie przejazdu: CARD — z portfela pasażera; CASH — prowizja z portfela kierowcy (model zadłużenia). */
export declare class SafeTaxiService {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    private platformUserId;
    private commissionBps;
    /**
     * Dolne dopuszczalne saldo kierowcy (minor units), np. -10000 = -100 PLN.
     * `MAX_DRIVER_DEBT` (≤ 0) albo legacy `MAX_DRIVER_DEBT_MINOR_UNITS` (≥ 0 → floor = -wartość).
     * Puste = brak limitu.
     */
    private maxDriverDebtFloor;
    private assertBalanceAfterCommissionOk;
    private assertDriverWithinDebtLimitForNewCashRide;
    getRideDriverId(rideId: string): Promise<string | null>;
    createRide(passengerId: string, driverId: string, paymentMethod?: RidePaymentMethod): Promise<{
        rideId: string;
    }>;
    /**
     * Atomowe rozliczenie:
     * - CARD: debet pasażera, split kierowca / platforma (jak dotąd).
     * - CASH: bez debetu pasażera; prowizja z kierowcy → platforma (`SAFE_TAXI_COMMISSION_DEBIT`).
     * Idempotencja: CARD — `stx:{rideId}:passenger`; CASH — `stx:{rideId}:commission_cash`.
     */
    settleRide(rideId: string, fareCents: bigint): Promise<{
        idempotent: boolean;
        platformCommissionCents: bigint;
        driverPayoutCents: bigint;
    }>;
}
//# sourceMappingURL=safe-taxi.service.d.ts.map