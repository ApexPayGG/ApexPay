import { Prisma, type PrismaClient } from "@prisma/client";
export type BracketAdvanceResult = {
    tournamentCompleted: boolean;
    createdNextRoundMatches: number;
};
export declare class TournamentBracketService {
    constructor(_prisma: PrismaClient);
    /**
     * Po zamknięciu meczu (RESOLVED / SETTLED): jeśli cała runda jest gotowa, tworzy następną
     * albo ustawia turniej na COMPLETED (finał rozstrzygnięty).
     * Wywoływać w tej samej transakcji co rozstrzygnięcie meczu; na początku blokuje wiersz turnieju.
     */
    advanceAfterTerminalMatch(tournamentId: string, tx: Prisma.TransactionClient): Promise<BracketAdvanceResult>;
}
//# sourceMappingURL=tournament-bracket.service.d.ts.map