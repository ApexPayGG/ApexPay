import type { Request, Response } from "express";
import { PrismaClient, Prisma } from "@prisma/client";
import { ClearingService } from "../services/clearing.service.js";
import type { WebSocketService } from "../services/websocket.service.js";

function paramId(raw: string | string[] | undefined): string | undefined {
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string") {
    return raw[0];
  }
  return undefined;
}

export class MatchController {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clearingService: ClearingService,
    private readonly wsService: WebSocketService,
  ) {}

  async reportResult(req: Request, res: Response): Promise<void> {
    try {
      const rawMatchId = paramId(req.params.id);
      const reporterId = (req as { user?: { id?: string } }).user?.id;
      const { claimedWinnerId } = req.body as { claimedWinnerId?: unknown };

      if (
        typeof reporterId !== "string" ||
        reporterId.trim().length === 0
      ) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const trimmedReporter = reporterId.trim();

      if (
        rawMatchId === undefined ||
        rawMatchId.trim().length === 0 ||
        typeof claimedWinnerId !== "string" ||
        claimedWinnerId.trim().length === 0
      ) {
        res.status(400).json({ error: "Brak ID meczu lub ID zwycięzcy." });
        return;
      }

      const matchId = rawMatchId.trim();
      const trimmedClaimedWinner = claimedWinnerId.trim();

      const result = await this.prisma.$transaction(
        async (tx) => {
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

                await this.clearingService.processPayout(
                  matchId,
                  r1.claimedWinnerId,
                  tx,
                );

                return {
                  status: "RESOLVED" as const,
                  winnerId: r1.claimedWinnerId,
                };
              }

              await tx.match.update({
                where: { id: matchId },
                data: { status: "DISPUTED" },
              });
              return { status: "DISPUTED" as const };
            }
          }

          return { status: "PENDING_OPPONENT" as const };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        },
      );

      if (result.status === "RESOLVED" && "winnerId" in result) {
        this.wsService.notifyWallet(result.winnerId, "PAYOUT_RECEIVED", {
          message:
            "Konsensus potwierdzony. Środki z rozliczenia meczu wpłynęły na portfel.",
          matchId,
        });
      }

      res.status(200).json({
        status: "success",
        message: "Raport przyjęty.",
        matchState: result.status,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : undefined;
      console.error("[ApexPay Engine] Report failed:", msg ?? error);

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        res
          .status(503)
          .json({ error: "Nie udało się zapisać raportu. Spróbuj ponownie." });
        return;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
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

      res.status(500).json({
        error: "Wewnętrzny błąd silnika konsensusu.",
      });
    }
  }

  async resolveDispute(req: Request, res: Response): Promise<void> {
    try {
      const rawMatchId = paramId(req.params.id);
      const { finalWinnerId } = req.body as { finalWinnerId?: unknown };

      if (
        rawMatchId === undefined ||
        rawMatchId.trim().length === 0 ||
        typeof finalWinnerId !== "string" ||
        finalWinnerId.trim().length === 0
      ) {
        res.status(400).json({ error: "Brak ID meczu lub ID zwycięzcy." });
        return;
      }

      const matchId = rawMatchId.trim();
      const winnerId = finalWinnerId.trim();

      await this.prisma.$transaction(
        async (tx) => {
          const match = await tx.match.findUnique({ where: { id: matchId } });
          if (!match) {
            throw new Error("MATCH_NOT_FOUND");
          }
          if (match.status === "RESOLVED") {
            throw new Error("ALREADY_RESOLVED");
          }

          await tx.match.update({
            where: { id: matchId },
            data: { status: "RESOLVED", winnerId },
          });

          await this.clearingService.processPayout(matchId, winnerId, tx);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        },
      );

      this.wsService.notifyWallet(winnerId, "PAYOUT_RECEIVED", {
        message:
          "Spór rozstrzygnięty na Twoją korzyść. Środki wpłynęły na portfel.",
        matchId,
      });

      res.status(200).json({
        status: "success",
        message: "Spór rozstrzygnięty. Środki rozksięgowane.",
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : undefined;
      console.error("[ApexPay Engine] Dispute resolution failed:", msg ?? error);

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
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
