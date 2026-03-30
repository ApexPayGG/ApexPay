import type { PrismaClient } from "@prisma/client";
import { Prisma, TransactionType } from "@prisma/client";
import { matchResolutionDurationSeconds } from "../monitoring/metrics.js";

const PLATFORM_FEE_PERCENT = 10n;
const ORGANIZER_CUT_PERCENT = 50n;
const MAX_DEADLOCK_RETRIES = 3;

export class MatchSettlementError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "MatchSettlementError";
  }
}

type LockedMatchRow = {
  id: string;
  status: string;
  winnerId: string | null;
  tournamentId: string;
};

export type SettleDisputedMatchResult = {
  matchId: string;
  status: "SETTLED";
  winnerId: string;
};

export class MatchSettlementService {
  constructor(private readonly prisma: PrismaClient) {}

  async settleDisputedMatch(input: {
    matchId: string;
    finalWinnerId: string;
  }): Promise<SettleDisputedMatchResult> {
    const { matchId, finalWinnerId } = input;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_DEADLOCK_RETRIES; attempt += 1) {
      try {
        const endResolutionTimer = matchResolutionDurationSeconds.startTimer();
        try {
          return await this.prisma.$transaction(
            async (tx) => {
            const locked = await tx.$queryRaw<LockedMatchRow[]>(
              Prisma.sql`
                SELECT id, status, "winnerId", "tournamentId"
                FROM "Match"
                WHERE id = ${matchId}
                FOR UPDATE
              `,
            );
            const row = locked[0];
            if (row === undefined) {
              throw new MatchSettlementError("MATCH_NOT_FOUND");
            }
            if (row.status === "SETTLED") {
              throw new MatchSettlementError("MATCH_ALREADY_SETTLED");
            }
            if (row.status !== "DISPUTED") {
              throw new MatchSettlementError("MATCH_NOT_DISPUTED");
            }

            const match = await tx.match.findUnique({
              where: { id: matchId },
              include: {
                tournament: {
                  include: {
                    participants: true,
                    organizer: { include: { wallet: true } },
                  },
                },
              },
            });

            if (!match?.tournament) {
              throw new Error("CRITICAL: Brak danych do rozliczenia.");
            }

            const t = match.tournament;
            const participantsCount = BigInt(t.participants.length);
            const totalPool = t.entryFee * participantsCount;
            const platformTotalFee =
              totalPool > 0n
                ? (totalPool * PLATFORM_FEE_PERCENT) / 100n
                : 0n;
            const organizerCut =
              platformTotalFee > 0n
                ? (platformTotalFee * ORGANIZER_CUT_PERCENT) / 100n
                : 0n;
            const winnerPayout =
              totalPool > platformTotalFee ? totalPool - platformTotalFee : 0n;

            const winnerWallet = await tx.wallet.findUnique({
              where: { userId: finalWinnerId },
            });
            if (!winnerWallet) {
              throw new Error("CRITICAL: Zwycięzca nie ma portfela.");
            }

            if (winnerPayout > 0n) {
              await tx.wallet.update({
                where: { id: winnerWallet.id },
                data: { balance: { increment: winnerPayout } },
              });
              await tx.transaction.create({
                data: {
                  amount: winnerPayout,
                  referenceId: `payout_win_v1_${matchId}`,
                  type: TransactionType.PRIZE_PAYOUT,
                  walletId: winnerWallet.id,
                },
              });
            }

            if (organizerCut > 0n && t.organizer.wallet) {
              await tx.wallet.update({
                where: { id: t.organizer.wallet.id },
                data: { balance: { increment: organizerCut } },
              });
              await tx.transaction.create({
                data: {
                  amount: organizerCut,
                  referenceId: `payout_org_v1_${matchId}`,
                  type: TransactionType.PRIZE_PAYOUT,
                  walletId: t.organizer.wallet.id,
                },
              });
            }

            await tx.userBalanceLedger.create({
              data: {
                userId: finalWinnerId,
                matchId,
                amountDelta: winnerPayout,
              },
            });
            if (organizerCut > 0n && t.organizer.wallet) {
              await tx.userBalanceLedger.create({
                data: {
                  userId: t.organizer.id,
                  matchId,
                  amountDelta: organizerCut,
                },
              });
            }

            await tx.outboxEvent.create({
              data: {
                eventType: "FUNDS_SETTLED",
                payload: {
                  matchId,
                  winnerId: finalWinnerId,
                  winnerPayout: winnerPayout.toString(),
                  organizerCut: organizerCut.toString(),
                  platformFeeTotal: platformTotalFee.toString(),
                },
              },
            });

            await tx.match.update({
              where: { id: matchId },
              data: { status: "SETTLED", winnerId: finalWinnerId },
            });

            return {
              matchId,
              status: "SETTLED" as const,
              winnerId: finalWinnerId,
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5000,
            timeout: 15000,
          },
        );
        } finally {
          endResolutionTimer();
        }
      } catch (error: unknown) {
        lastError = error;
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034" &&
          attempt < MAX_DEADLOCK_RETRIES - 1
        ) {
          continue;
        }
        throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Settlement failed after retries");
  }
}
