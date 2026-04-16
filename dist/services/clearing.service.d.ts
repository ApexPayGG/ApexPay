import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
export declare class ClearingService {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    private readonly PLATFORM_FEE_PERCENT;
    private readonly ORGANIZER_CUT_PERCENT;
    /**
     * @returns true jeśli wykonano wypłatę nagrody (mecz z `awardsTournamentPrize`).
     */
    processPayout(matchId: string, winnerId: string, tx: Prisma.TransactionClient): Promise<boolean>;
}
//# sourceMappingURL=clearing.service.d.ts.map