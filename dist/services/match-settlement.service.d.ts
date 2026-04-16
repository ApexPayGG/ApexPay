import type { PrismaClient } from "@prisma/client";
import { TournamentBracketService } from "./tournament-bracket.service.js";
export declare class MatchSettlementError extends Error {
    readonly code: string;
    constructor(code: string, message?: string);
}
export type SettleDisputedMatchResult = {
    matchId: string;
    status: "SETTLED";
    winnerId: string;
    /** true gdy wykonano realną wypłatę na portfel zwycięzcy (finał / nagroda turniejowa). */
    prizePaid: boolean;
};
export declare class MatchSettlementService {
    private readonly prisma;
    private readonly bracketService;
    constructor(prisma: PrismaClient, bracketService?: TournamentBracketService);
    settleDisputedMatch(input: {
        matchId: string;
        finalWinnerId: string;
    }): Promise<SettleDisputedMatchResult>;
}
//# sourceMappingURL=match-settlement.service.d.ts.map