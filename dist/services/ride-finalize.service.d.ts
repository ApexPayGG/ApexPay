import { type PrismaClient } from "@prisma/client";
import type { Request } from "express";
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
export declare class RideFinalizeConfigError extends Error {
    constructor(message: string);
}
export declare class RideFinalizeNotFoundError extends Error {
    constructor(message: string);
}
export declare class RideFinalizeAuthorizationError extends Error {
    constructor(message: string);
}
export declare class RideFinalizeInvalidStateError extends Error {
    constructor(message: string);
}
export declare class RideFinalizeService {
    private readonly prisma;
    private readonly auditLogService?;
    constructor(prisma: PrismaClient, auditLogService?: AuditLogService | undefined);
    finalizeRide(input: RideFinalizeInput, req?: Request): Promise<RideFinalizeResult>;
}
//# sourceMappingURL=ride-finalize.service.d.ts.map