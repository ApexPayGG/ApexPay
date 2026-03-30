import type { PrismaClient } from "@prisma/client";
export declare class MatchSettlementError extends Error {
    readonly code: string;
    constructor(code: string, message?: string);
}
export type SettleDisputedMatchResult = {
    matchId: string;
    status: "SETTLED";
    winnerId: string;
};
export declare class MatchSettlementService {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    settleDisputedMatch(input: {
        matchId: string;
        finalWinnerId: string;
    }): Promise<SettleDisputedMatchResult>;
}
//# sourceMappingURL=match-settlement.service.d.ts.map