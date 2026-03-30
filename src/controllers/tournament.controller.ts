import type { Request, Response } from "express";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  Prisma,
  TransactionType,
} from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL is required");
}
const tournamentPool = new pg.Pool({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter: new PrismaPg(tournamentPool) });

const MIN_ENTRY_FEE_CENTS = 500;
const MAX_PLAYERS_CAP = 1000;

function isInsufficientFundsDbError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (err.code === "P2025") {
    return true;
  }
  if (err.message.includes("wallet_balance_check")) {
    return true;
  }
  const meta = err.meta as { constraint?: string } | undefined;
  if (meta?.constraint === "wallet_balance_check") {
    return true;
  }
  return false;
}

function joinErrorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

export class TournamentController {
  async createTournament(req: Request, res: Response): Promise<void> {
    try {
      const { title, entryFeeCents, maxPlayers, registrationEndsInHours } = req.body;
      const organizerId = (req as { user?: { id?: string } }).user?.id;

      if (
        typeof organizerId !== "string" ||
        organizerId.trim().length === 0
      ) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      if (!title || !entryFeeCents || !maxPlayers || !registrationEndsInHours) {
        res.status(400).json({ error: "Brakuje kluczowych parametrów turnieju." });
        return;
      }

      const fee = Number(entryFeeCents);
      const players = Number(maxPlayers);

      if (!Number.isFinite(fee) || !Number.isInteger(fee) || fee < 0) {
        res.status(400).json({ error: "Brakuje kluczowych parametrów turnieju." });
        return;
      }

      if (!Number.isFinite(players) || !Number.isInteger(players)) {
        res.status(400).json({ error: "Brakuje kluczowych parametrów turnieju." });
        return;
      }

      const hours = Number(registrationEndsInHours);
      if (!Number.isFinite(hours) || hours <= 0 || !Number.isInteger(hours)) {
        res.status(400).json({ error: "Brakuje kluczowych parametrów turnieju." });
        return;
      }

      if (fee < MIN_ENTRY_FEE_CENTS) {
        res.status(400).json({
          error: "Biznesowa blokada",
          message: `Minimalne wpisowe to ${MIN_ENTRY_FEE_CENTS / 100} PLN.`,
        });
        return;
      }

      if (players < 2 || players > MAX_PLAYERS_CAP) {
        res.status(400).json({
          error: `Limit graczy musi wynosić od 2 do ${MAX_PLAYERS_CAP}.`,
        });
        return;
      }

      const endsAt = new Date();
      endsAt.setHours(endsAt.getHours() + hours);

      const tournament = await prisma.tournament.create({
        data: {
          title,
          entryFee: BigInt(fee),
          maxPlayers: players,
          registrationEndsAt: endsAt,
          organizerId: organizerId.trim(),
          status: "REGISTRATION",
        },
      });

      res.status(201).json({
        status: "success",
        message: "Turniej ApexPay zabezpieczony i gotowy na wpłaty.",
        data: {
          tournamentId: tournament.id,
          entryFeeCents: tournament.entryFee.toString(),
          maxPlayers: tournament.maxPlayers,
          deadline: tournament.registrationEndsAt,
          joinLink: `https://apexpay.io/pay/${tournament.id}`,
        },
      });
    } catch (error) {
      console.error("[ApexPay Engine] Błąd generowania turnieju:", error);
      res.status(500).json({ error: "Wewnętrzny błąd silnika ApexPay." });
    }
  }

  async joinTournament(req: Request, res: Response): Promise<void> {
    try {
      const rawTournamentId = req.params.id;
      const tournamentId =
        typeof rawTournamentId === "string"
          ? rawTournamentId
          : Array.isArray(rawTournamentId)
            ? rawTournamentId[0]
            : undefined;
      const userId = (req as { user?: { id?: string } }).user?.id;

      if (typeof userId !== "string" || userId.trim().length === 0) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      if (
        tournamentId === undefined ||
        typeof tournamentId !== "string" ||
        tournamentId.trim().length === 0
      ) {
        res.status(400).json({ error: "Brak ID turnieju." });
        return;
      }

      const trimmedTournamentId = tournamentId.trim();
      const trimmedUserId = userId.trim();

      const result = await prisma.$transaction(
        async (tx) => {
          const tournament = await tx.tournament.findUnique({
            where: { id: trimmedTournamentId },
            include: { _count: { select: { participants: true } } },
          });

          if (!tournament) {
            throw new Error("NOT_FOUND");
          }
          if (tournament.status !== "REGISTRATION") {
            throw new Error("CLOSED");
          }
          if (new Date() > tournament.registrationEndsAt) {
            throw new Error("TIMEOUT");
          }
          if (tournament._count.participants >= tournament.maxPlayers) {
            throw new Error("FULL");
          }

          const existingParticipant = await tx.tournamentParticipant.findUnique({
            where: {
              tournamentId_userId: {
                tournamentId: trimmedTournamentId,
                userId: trimmedUserId,
              },
            },
          });
          if (existingParticipant) {
            throw new Error("ALREADY_JOINED");
          }

          const wallet = await tx.wallet.findUnique({
            where: { userId: trimmedUserId },
            select: { id: true },
          });
          if (!wallet) {
            throw new Error("NO_FUNDS");
          }

          try {
            await tx.wallet.update({
              where: { userId: trimmedUserId },
              data: { balance: { decrement: tournament.entryFee } },
            });
          } catch (err) {
            if (isInsufficientFundsDbError(err)) {
              throw new Error("NO_FUNDS");
            }
            throw err;
          }

          const referenceId = `escrow_${trimmedTournamentId}_${trimmedUserId}_${crypto.randomUUID()}`;

          await tx.transaction.create({
            data: {
              amount: tournament.entryFee,
              referenceId,
              type: TransactionType.ESCROW_HOLD,
              walletId: wallet.id,
            },
          });

          return await tx.tournamentParticipant.create({
            data: {
              tournamentId: trimmedTournamentId,
              userId: trimmedUserId,
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        },
      );

      res.status(200).json({
        status: "success",
        message: "Wpisowe zamrożone w Escrow. Jesteś w grze.",
        data: { ticketId: result.id },
      });
    } catch (error: unknown) {
      const msg = joinErrorMessage(error);
      console.error("[ApexPay Engine] Join failed:", msg ?? error);

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        res
          .status(503)
          .json({ error: "Nie udało się dokończyć zapisu. Spróbuj ponownie." });
        return;
      }

      switch (msg) {
        case "NOT_FOUND":
          res.status(404).json({ error: "Turniej nie istnieje." });
          return;
        case "CLOSED":
          res.status(400).json({ error: "Rejestracja jest już zamknięta." });
          return;
        case "TIMEOUT":
          res.status(400).json({ error: "Czas na zapisy minął." });
          return;
        case "FULL":
          res.status(409).json({ error: "Brak miejsc. Turniej jest pełny." });
          return;
        case "ALREADY_JOINED":
          res.status(409).json({ error: "Masz już bilet na ten turniej." });
          return;
        case "NO_FUNDS":
          res
            .status(402)
            .json({
              error: "Brak środków na portfelu ApexPay. Doładuj konto.",
            });
          return;
        default:
          res
            .status(500)
            .json({ error: "Wewnętrzny błąd transakcji Escrow." });
      }
    }
  }

  async cancelAndRefund(req: Request, res: Response): Promise<void> {
    try {
      const rawTournamentId = req.params.id;
      const tournamentId =
        typeof rawTournamentId === "string"
          ? rawTournamentId
          : Array.isArray(rawTournamentId)
            ? rawTournamentId[0]
            : undefined;
      const userId = (req as { user?: { id?: string } }).user?.id;

      if (typeof userId !== "string" || userId.trim().length === 0) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      if (
        tournamentId === undefined ||
        typeof tournamentId !== "string" ||
        tournamentId.trim().length === 0
      ) {
        res.status(400).json({ error: "Brak ID turnieju." });
        return;
      }

      const tid = tournamentId.trim();
      const uid = userId.trim();

      await prisma.$transaction(
        async (tx) => {
          const tournament = await tx.tournament.findUnique({
            where: { id: tid },
            include: {
              participants: {
                include: { user: { include: { wallet: true } } },
              },
            },
          });

          if (!tournament) {
            throw new Error("TOURNAMENT_NOT_FOUND");
          }
          if (tournament.organizerId !== uid) {
            throw new Error("FORBIDDEN_NOT_ORGANIZER");
          }
          if (
            tournament.status === "COMPLETED" ||
            tournament.status === "CANCELED"
          ) {
            throw new Error("INVALID_STATE_FOR_REFUND");
          }

          for (const participant of tournament.participants) {
            const wallet = participant.user.wallet;
            if (wallet) {
              await tx.wallet.update({
                where: { id: wallet.id },
                data: { balance: { increment: tournament.entryFee } },
              });

              await tx.transaction.create({
                data: {
                  amount: tournament.entryFee,
                  referenceId: `refund_${tid}_${participant.userId}_${crypto.randomUUID()}`,
                  type: TransactionType.REFUND,
                  walletId: wallet.id,
                },
              });
            }
          }

          await tx.tournament.update({
            where: { id: tid },
            data: { status: "CANCELED" },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        },
      );

      res.status(200).json({
        status: "success",
        message: "Turniej anulowany. Kapitał zwrócony graczom.",
      });
    } catch (error: unknown) {
      const msg = joinErrorMessage(error);
      console.error("[ApexPay Engine] Refund failed:", msg ?? error);

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        res
          .status(503)
          .json({ error: "Nie udało się dokończyć zwrotów. Spróbuj ponownie." });
        return;
      }

      switch (msg) {
        case "TOURNAMENT_NOT_FOUND":
          res.status(404).json({ error: "Turniej nie istnieje." });
          return;
        case "FORBIDDEN_NOT_ORGANIZER":
          res.status(403).json({ error: "Tylko organizator może anulować turniej." });
          return;
        case "INVALID_STATE_FOR_REFUND":
          res.status(409).json({
            error: "Nie można zwrócić wpisowego w tym stanie turnieju.",
          });
          return;
        default:
          res.status(500).json({
            error: "Wewnętrzny błąd zwrotu kapitału (Escrow Reversal).",
          });
      }
    }
  }
}
