import { Prisma, type PrismaClient } from "@prisma/client";

const TERMINAL = new Set<string>(["RESOLVED", "SETTLED"]);

export type BracketAdvanceResult = {
  tournamentCompleted: boolean;
  createdNextRoundMatches: number;
};

export class TournamentBracketService {
  constructor(_prisma: PrismaClient) {
    void _prisma;
  }

  /**
   * Po zamknięciu meczu (RESOLVED / SETTLED): jeśli cała runda jest gotowa, tworzy następną
   * albo ustawia turniej na COMPLETED (finał rozstrzygnięty).
   * Wywoływać w tej samej transakcji co rozstrzygnięcie meczu; na początku blokuje wiersz turnieju.
   */
  async advanceAfterTerminalMatch(
    tournamentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<BracketAdvanceResult> {
    await tx.$executeRaw(
      Prisma.sql`SELECT id FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE`,
    );

    const tournament = await tx.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament || tournament.status !== "IN_PROGRESS") {
      return { tournamentCompleted: false, createdNextRoundMatches: 0 };
    }

    const matches = await tx.match.findMany({
      where: { tournamentId },
      orderBy: [{ roundNumber: "asc" }, { createdAt: "asc" }],
    });

    const byRound = new Map<number, typeof matches>();
    for (const m of matches) {
      const list = byRound.get(m.roundNumber) ?? [];
      list.push(m);
      byRound.set(m.roundNumber, list);
    }

    const rounds = [...byRound.keys()].sort((a, b) => a - b);

    for (const R of rounds) {
      const inRound = byRound.get(R);
      if (inRound === undefined || inRound.length === 0) {
        continue;
      }

      const allDone = inRound.every((m) => TERMINAL.has(m.status));
      if (!allDone) {
        return { tournamentCompleted: false, createdNextRoundMatches: 0 };
      }

      const nextRoundExisting = byRound.get(R + 1) ?? [];
      if (nextRoundExisting.length > 0) {
        continue;
      }

      const ordered = [...inRound].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      const winners = ordered
        .map((m) => m.winnerId)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

      if (winners.length !== inRound.length) {
        return { tournamentCompleted: false, createdNextRoundMatches: 0 };
      }

      if (inRound.length === 1) {
        await tx.tournament.update({
          where: { id: tournamentId },
          data: { status: "COMPLETED" },
        });
        return { tournamentCompleted: true, createdNextRoundMatches: 0 };
      }

      if (winners.length % 2 !== 0) {
        throw new Error("BRACKET_ODD_WINNERS");
      }

      const pairCount = winners.length / 2;
      const isFinalRound = pairCount === 1;
      const rows = [];
      for (let i = 0; i < winners.length; i += 2) {
        const a = winners[i];
        const b = winners[i + 1];
        if (a === undefined || b === undefined) {
          throw new Error("BRACKET_PAIRING");
        }
        rows.push({
          tournamentId,
          roundNumber: R + 1,
          status: "PENDING" as const,
          playerAId: a,
          playerBId: b,
          awardsTournamentPrize: isFinalRound,
        });
      }

      await tx.match.createMany({ data: rows });
      return {
        tournamentCompleted: false,
        createdNextRoundMatches: rows.length,
      };
    }

    return { tournamentCompleted: false, createdNextRoundMatches: 0 };
  }
}
