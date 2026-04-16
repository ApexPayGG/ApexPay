import { PrismaClient, Prisma } from "@prisma/client";
import { ClearingService } from "../services/clearing.service.js";
import { TournamentBracketService } from "../services/tournament-bracket.service.js";
function paramId(raw) {
    if (typeof raw === "string") {
        return raw;
    }
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string") {
        return raw[0];
    }
    return undefined;
}
function matchHasAssignedPlayers(match) {
    return match.playerAId != null && match.playerBId != null;
}
function assertReportPlayersAllowed(match, reporterId, claimedWinnerId) {
    if (!matchHasAssignedPlayers(match)) {
        return;
    }
    const allowed = new Set([match.playerAId, match.playerBId]);
    if (!allowed.has(reporterId)) {
        throw new Error("REPORTER_NOT_IN_MATCH");
    }
    if (!allowed.has(claimedWinnerId)) {
        throw new Error("CLAIMED_WINNER_NOT_IN_MATCH");
    }
}
function assertResolveWinnerInMatch(match, finalWinnerId) {
    if (!matchHasAssignedPlayers(match)) {
        return;
    }
    const allowed = new Set([match.playerAId, match.playerBId]);
    if (!allowed.has(finalWinnerId)) {
        throw new Error("WINNER_NOT_IN_MATCH");
    }
}
export class MatchController {
    prisma;
    clearingService;
    wsService;
    bracketService;
    constructor(prisma, clearingService, wsService, bracketService) {
        this.prisma = prisma;
        this.clearingService = clearingService;
        this.wsService = wsService;
        this.bracketService =
            bracketService ?? new TournamentBracketService(prisma);
    }
    async reportResult(req, res) {
        try {
            const rawMatchId = paramId(req.params.id);
            const reporterId = req.user?.id;
            const { claimedWinnerId } = req.body;
            if (typeof reporterId !== "string" ||
                reporterId.trim().length === 0) {
                res.status(401).json({ error: "Unauthorized" });
                return;
            }
            const trimmedReporter = reporterId.trim();
            if (rawMatchId === undefined ||
                rawMatchId.trim().length === 0 ||
                typeof claimedWinnerId !== "string" ||
                claimedWinnerId.trim().length === 0) {
                res.status(400).json({ error: "Brak ID meczu lub ID zwycięzcy." });
                return;
            }
            const matchId = rawMatchId.trim();
            const trimmedClaimedWinner = claimedWinnerId.trim();
            const result = await this.prisma.$transaction(async (tx) => {
                const match = await tx.match.findUnique({
                    where: { id: matchId },
                    include: { reports: true },
                });
                if (!match) {
                    throw new Error("MATCH_NOT_FOUND");
                }
                if (match.status !== "PENDING") {
                    throw new Error("MATCH_CLOSED_OR_DISPUTED");
                }
                assertReportPlayersAllowed(match, trimmedReporter, trimmedClaimedWinner);
                await tx.matchReport.create({
                    data: {
                        matchId,
                        reporterId: trimmedReporter,
                        claimedWinnerId: trimmedClaimedWinner,
                    },
                });
                const allReports = await tx.matchReport.findMany({
                    where: { matchId },
                });
                if (allReports.length === 2) {
                    const r1 = allReports[0];
                    const r2 = allReports[1];
                    if (r1 !== undefined && r2 !== undefined) {
                        if (r1.claimedWinnerId === r2.claimedWinnerId) {
                            await tx.match.update({
                                where: { id: matchId },
                                data: {
                                    status: "RESOLVED",
                                    winnerId: r1.claimedWinnerId,
                                },
                            });
                            const prizePaid = await this.clearingService.processPayout(matchId, r1.claimedWinnerId, tx);
                            await this.bracketService.advanceAfterTerminalMatch(match.tournamentId, tx);
                            return {
                                status: "RESOLVED",
                                winnerId: r1.claimedWinnerId,
                                prizePaid,
                            };
                        }
                        await tx.match.update({
                            where: { id: matchId },
                            data: { status: "DISPUTED" },
                        });
                        return { status: "DISPUTED" };
                    }
                }
                return { status: "PENDING_OPPONENT" };
            }, {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                maxWait: 5000,
                timeout: 10000,
            });
            if (result.status === "RESOLVED" &&
                "winnerId" in result &&
                "prizePaid" in result &&
                result.prizePaid) {
                this.wsService.notifyWallet(result.winnerId, "PAYOUT_RECEIVED", {
                    message: "Konsensus potwierdzony. Środki z rozliczenia meczu wpłynęły na portfel.",
                    matchId,
                });
            }
            res.status(200).json({
                status: "success",
                message: "Raport przyjęty.",
                matchState: result.status,
            });
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : undefined;
            console.error("[ApexPay Engine] Report failed:", msg ?? error);
            if (error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === "P2034") {
                res
                    .status(503)
                    .json({ error: "Nie udało się zapisać raportu. Spróbuj ponownie." });
                return;
            }
            if (error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === "P2002") {
                res.status(409).json({
                    error: "Już zaraportowałeś wynik tego meczu.",
                });
                return;
            }
            if (msg === "MATCH_NOT_FOUND") {
                res.status(404).json({ error: "Mecz nie istnieje." });
                return;
            }
            if (msg === "MATCH_CLOSED_OR_DISPUTED") {
                res.status(409).json({
                    error: "Mecz jest już rozstrzygnięty lub w sporze.",
                });
                return;
            }
            if (msg === "REPORTER_NOT_IN_MATCH") {
                res.status(403).json({
                    error: "Tylko zawodnicy przypisani do tego meczu mogą zgłaszać wynik.",
                });
                return;
            }
            if (msg === "CLAIMED_WINNER_NOT_IN_MATCH") {
                res.status(400).json({
                    error: "Zwycięzca musi być jednym z graczy tego meczu.",
                });
                return;
            }
            res.status(500).json({
                error: "Wewnętrzny błąd silnika konsensusu.",
            });
        }
    }
    async resolveDispute(req, res) {
        try {
            const rawMatchId = paramId(req.params.id);
            const { finalWinnerId } = req.body;
            if (rawMatchId === undefined ||
                rawMatchId.trim().length === 0 ||
                typeof finalWinnerId !== "string" ||
                finalWinnerId.trim().length === 0) {
                res.status(400).json({ error: "Brak ID meczu lub ID zwycięzcy." });
                return;
            }
            const matchId = rawMatchId.trim();
            const winnerId = finalWinnerId.trim();
            let prizePaid = false;
            await this.prisma.$transaction(async (tx) => {
                const match = await tx.match.findUnique({ where: { id: matchId } });
                if (!match) {
                    throw new Error("MATCH_NOT_FOUND");
                }
                if (match.status === "RESOLVED") {
                    throw new Error("ALREADY_RESOLVED");
                }
                assertResolveWinnerInMatch(match, winnerId);
                const tournamentId = match.tournamentId;
                await tx.match.update({
                    where: { id: matchId },
                    data: { status: "RESOLVED", winnerId },
                });
                prizePaid = await this.clearingService.processPayout(matchId, winnerId, tx);
                await this.bracketService.advanceAfterTerminalMatch(tournamentId, tx);
            }, {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                maxWait: 5000,
                timeout: 10000,
            });
            if (prizePaid) {
                this.wsService.notifyWallet(winnerId, "PAYOUT_RECEIVED", {
                    message: "Spór rozstrzygnięty na Twoją korzyść. Środki wpłynęły na portfel.",
                    matchId,
                });
            }
            res.status(200).json({
                status: "success",
                message: "Spór rozstrzygnięty. Środki rozksięgowane.",
            });
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : undefined;
            console.error("[ApexPay Engine] Dispute resolution failed:", msg ?? error);
            if (error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === "P2034") {
                res
                    .status(503)
                    .json({ error: "Nie udało się dokończyć rozstrzygnięcia. Spróbuj ponownie." });
                return;
            }
            if (msg === "MATCH_NOT_FOUND") {
                res.status(404).json({ error: "Mecz nie istnieje." });
                return;
            }
            if (msg === "ALREADY_RESOLVED") {
                res.status(409).json({ error: "Mecz jest już rozstrzygnięty." });
                return;
            }
            if (msg === "WINNER_NOT_IN_MATCH") {
                res.status(400).json({
                    error: "Zwycięzca musi być jednym z graczy tego meczu.",
                });
                return;
            }
            if (msg?.startsWith("CRITICAL:")) {
                res.status(500).json({ error: "Błąd rozliczenia po rozstrzygnięciu sporu." });
                return;
            }
            res.status(500).json({
                error: "Wewnętrzny błąd arbitrażu ApexPay.",
            });
        }
    }
}
//# sourceMappingURL=match.controller.js.map