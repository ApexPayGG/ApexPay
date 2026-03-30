import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
export declare class ClearingService {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    private readonly PLATFORM_FEE_PERCENT;
    private readonly ORGANIZER_CUT_PERCENT;
    processPayout(matchId: string, winnerId: string, tx: Prisma.TransactionClient): Promise<void>;
}
//# sourceMappingURL=clearing.service.d.ts.map