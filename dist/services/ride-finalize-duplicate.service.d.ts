import { type PrismaClient } from "@prisma/client";
import type { RideFinalizeResult } from "./ride-finalize.service.js";
export declare function findDurableRideFinalizeDuplicate(prisma: PrismaClient, input: {
    rideId: string;
    driverConnectedAccountId: string;
    integratorUserId: string;
}): Promise<RideFinalizeResult | null>;
//# sourceMappingURL=ride-finalize-duplicate.service.d.ts.map