import { Prisma, TransactionType } from "@prisma/client";
export class ClearingService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    PLATFORM_FEE_PERCENT = 10n;
    ORGANIZER_CUT_PERCENT = 50n;
    async processPayout(matchId, winnerId, tx) {
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
        if (!match || !match.tournament) {
            throw new Error("CRITICAL: Brak danych do rozliczenia.");
        }
        const t = match.tournament;
        const participantsCount = BigInt(t.participants.length);
        const totalPool = t.entryFee * participantsCount;
        if (totalPool === 0n) {
            return;
        }
        const platformTotalFee = (totalPool * this.PLATFORM_FEE_PERCENT) / 100n;
        const organizerCut = (platformTotalFee * this.ORGANIZER_CUT_PERCENT) / 100n;
        const winnerPayout = totalPool - platformTotalFee;
        const winnerWallet = await tx.wallet.findUnique({ where: { userId: winnerId } });
        if (!winnerWallet) {
            throw new Error("CRITICAL: Zwycięzca nie ma portfela.");
        }
        await tx.wallet.update({
            where: { id: winnerWallet.id },
            data: { balance: { increment: winnerPayout } },
        });
        await tx.transaction.create({
            data: {
                amount: winnerPayout,
                referenceId: `payout_win_${match.id}_${Date.now()}`,
                type: TransactionType.PRIZE_PAYOUT,
                walletId: winnerWallet.id,
            },
        });
        if (organizerCut > 0n && t.organizer.wallet) {
            await tx.wallet.update({
                where: { id: t.organizer.wallet.id },
                data: { balance: { increment: organizerCut } },
            });
            await tx.transaction.create({
                data: {
                    amount: organizerCut,
                    referenceId: `payout_org_${match.id}_${Date.now()}`,
                    type: TransactionType.PRIZE_PAYOUT,
                    walletId: t.organizer.wallet.id,
                },
            });
        }
    }
}
//# sourceMappingURL=clearing.service.js.map