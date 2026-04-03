import type { Request, Response } from "express";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  Prisma,
  TransactionType,
  type TournamentStatus,
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

  /**
   * Start turnieju (Etap 2): REGISTRATION → IN_PROGRESS, generacja meczów 1. rundy.
   *
   * - Wyłącznie **organizator** (`organizerId` z turnieju = `user.id` z JWT).
   * - Wymaga statusu **REGISTRATION** oraz braku istniejących meczów (idempotencja względem „gołego” turnieju).
   * - Co najmniej **2** uczestników; **parzysta** liczba (MVP: N/2 meczów PENDING, pary wg `joinedAt` rosnąco).
   * - Każdy mecz dostaje **playerAId** / **playerBId** (kolejność par = kolejność zapisów), **roundNumber** = 1.
   * - **awardsTournamentPrize**: true tylko gdy w turnieju jest jeden mecz (finał od razu); przy większej drabince wypłata tylko z finału.
   * - Po sukcesie `POST .../join` zwraca błąd (rejestracja zamknięta).
   */
  async startTournament(req: Request, res: Response): Promise<void> {
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

      const outcome = await prisma.$transaction(
        async (tx) => {
          const tournament = await tx.tournament.findUnique({
            where: { id: tid },
            include: {
              participants: { orderBy: { joinedAt: "asc" } },
              matches: { select: { id: true } },
            },
          });

          if (!tournament) {
            throw new Error("NOT_FOUND");
          }
          if (tournament.organizerId !== uid) {
            throw new Error("FORBIDDEN_NOT_ORGANIZER");
          }
          if (tournament.status !== "REGISTRATION") {
            throw new Error("NOT_REGISTRATION");
          }
          if (tournament.matches.length > 0) {
            throw new Error("ALREADY_STARTED");
          }

          const n = tournament.participants.length;
          if (n < 2) {
            throw new Error("TOO_FEW_PLAYERS");
          }
          if (n % 2 !== 0) {
            throw new Error("ODD_PLAYERS");
          }

          const pairCount = n / 2;
          const rows = [] as {
            tournamentId: string;
            status: "PENDING";
            playerAId: string;
            playerBId: string;
            roundNumber: number;
            awardsTournamentPrize: boolean;
          }[];
          const isSingleMatchFinal = pairCount === 1;
          for (let i = 0; i < n; i += 2) {
            const a = tournament.participants[i]!;
            const b = tournament.participants[i + 1]!;
            rows.push({
              tournamentId: tid,
              status: "PENDING",
              playerAId: a.userId,
              playerBId: b.userId,
              roundNumber: 1,
              awardsTournamentPrize: isSingleMatchFinal,
            });
          }

          await tx.match.createMany({ data: rows });

          const newMatches = await tx.match.findMany({
            where: { tournamentId: tid },
            orderBy: { createdAt: "asc" },
            select: { id: true, playerAId: true, playerBId: true },
            take: pairCount,
          });

          await tx.tournament.update({
            where: { id: tid },
            data: { status: "IN_PROGRESS" },
          });

          return {
            matchIds: newMatches.map((m) => m.id),
            round1: newMatches.map((m) => ({
              matchId: m.id,
              playerAId: m.playerAId,
              playerBId: m.playerBId,
            })),
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        },
      );

      res.status(200).json({
        status: "success",
        message:
          "Turniej rozpoczęty. Utworzono mecze pierwszej rundy (status PENDING).",
        data: {
          tournamentId: tid,
          matchIds: outcome.matchIds,
          round1Matches: outcome.matchIds.length,
          round1: outcome.round1,
        },
      });
    } catch (error: unknown) {
      const msg = joinErrorMessage(error);
      console.error("[ApexPay Engine] Start tournament failed:", msg ?? error);

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        res
          .status(503)
          .json({ error: "Nie udało się zakończyć startu. Spróbuj ponownie." });
        return;
      }

      switch (msg) {
        case "NOT_FOUND":
          res.status(404).json({ error: "Turniej nie istnieje." });
          return;
        case "FORBIDDEN_NOT_ORGANIZER":
          res.status(403).json({ error: "Tylko organizator może rozpocząć turniej." });
          return;
        case "NOT_REGISTRATION":
          res.status(409).json({
            error: "Turniej nie jest w fazie rejestracji.",
          });
          return;
        case "ALREADY_STARTED":
          res.status(409).json({
            error: "Turniej ma już mecze — start nie jest możliwy ponownie.",
          });
          return;
        case "TOO_FEW_PLAYERS":
          res.status(400).json({
            error: "Wymaganych jest co najmniej dwóch zapisanych graczy.",
          });
          return;
        case "ODD_PLAYERS":
          res.status(400).json({
            error:
              "Liczba graczy musi być parzysta (MVP: brak wolnego losu). Dodaj lub usuń uczestnika.",
          });
          return;
        default:
          res.status(500).json({
            error: "Wewnętrzny błąd podczas startu turnieju.",
          });
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

  async listTournaments(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as { user?: { id?: string } }).user?.id;
      if (typeof userId !== "string" || userId.trim().length === 0) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const limitParam = req.query.limit;
      let limit = 20;
      if (limitParam !== undefined && limitParam !== "") {
        const raw =
          typeof limitParam === "string"
            ? limitParam
            : Array.isArray(limitParam) && typeof limitParam[0] === "string"
              ? limitParam[0]
              : undefined;
        if (raw === undefined) {
          res.status(400).json({ error: "Parametr limit musi być liczbą 1–50." });
          return;
        }
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > 50) {
          res.status(400).json({ error: "Parametr limit musi być liczbą 1–50." });
          return;
        }
        limit = n;
      }

      const statusParam = req.query.status;
      const where: { status?: TournamentStatus } = {};
      if (statusParam !== undefined && statusParam !== "") {
        const raw =
          typeof statusParam === "string"
            ? statusParam
            : Array.isArray(statusParam) && typeof statusParam[0] === "string"
              ? statusParam[0]
              : undefined;
        if (raw === undefined || raw.trim().length === 0) {
          res.status(400).json({ error: "Nieprawidłowy parametr status." });
          return;
        }
        const st = raw.trim() as TournamentStatus;
        const allowed: TournamentStatus[] = [
          "REGISTRATION",
          "IN_PROGRESS",
          "COMPLETED",
          "CANCELED",
        ];
        if (!allowed.includes(st)) {
          res.status(400).json({ error: "Nieprawidłowy status turnieju." });
          return;
        }
        where.status = st;
      }

      const rows = await prisma.tournament.findMany({
        where: where.status !== undefined ? { status: where.status } : {},
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          status: true,
          entryFee: true,
          maxPlayers: true,
          registrationEndsAt: true,
          minLevel: true,
          organizerId: true,
          createdAt: true,
          _count: { select: { participants: true } },
        },
      });

      res.status(200).json({
        status: "success",
        data: {
          items: rows.map((t) => ({
            tournamentId: t.id,
            title: t.title,
            status: t.status,
            entryFeeCents: t.entryFee.toString(),
            maxPlayers: t.maxPlayers,
            minLevel: t.minLevel,
            registrationEndsAt: t.registrationEndsAt,
            organizerId: t.organizerId,
            createdAt: t.createdAt,
            participantCount: t._count.participants,
          })),
        },
      });
    } catch (error: unknown) {
      console.error("[ApexPay Engine] Lista turniejów:", error);
      res.status(500).json({ error: "Wewnętrzny błąd listy turniejów." });
    }
  }

  async getTournament(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as { user?: { id?: string } }).user?.id;
      if (typeof userId !== "string" || userId.trim().length === 0) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const rawTournamentId = req.params.id;
      const tournamentId =
        typeof rawTournamentId === "string"
          ? rawTournamentId
          : Array.isArray(rawTournamentId)
            ? rawTournamentId[0]
            : undefined;

      if (
        tournamentId === undefined ||
        typeof tournamentId !== "string" ||
        tournamentId.trim().length === 0
      ) {
        res.status(400).json({ error: "Brak ID turnieju." });
        return;
      }

      const id = tournamentId.trim();

      const t = await prisma.tournament.findUnique({
        where: { id },
        include: {
          participants: {
            orderBy: { joinedAt: "asc" },
            select: { userId: true, joinedAt: true },
          },
          matches: {
            orderBy: [{ roundNumber: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              roundNumber: true,
              status: true,
              playerAId: true,
              playerBId: true,
              winnerId: true,
              awardsTournamentPrize: true,
              createdAt: true,
            },
          },
        },
      });

      if (!t) {
        res.status(404).json({ error: "Turniej nie istnieje." });
        return;
      }

      res.status(200).json({
        status: "success",
        data: {
          tournamentId: t.id,
          title: t.title,
          status: t.status,
          entryFeeCents: t.entryFee.toString(),
          maxPlayers: t.maxPlayers,
          minLevel: t.minLevel,
          registrationEndsAt: t.registrationEndsAt,
          organizerId: t.organizerId,
          createdAt: t.createdAt,
          participants: t.participants.map((p) => ({
            userId: p.userId,
            joinedAt: p.joinedAt,
          })),
          matches: t.matches.map((m) => ({
            matchId: m.id,
            roundNumber: m.roundNumber,
            status: m.status,
            playerAId: m.playerAId,
            playerBId: m.playerBId,
            winnerId: m.winnerId,
            awardsTournamentPrize: m.awardsTournamentPrize,
            createdAt: m.createdAt,
          })),
        },
      });
    } catch (error: unknown) {
      console.error("[ApexPay Engine] Szczegóły turnieju:", error);
      res.status(500).json({ error: "Wewnętrzny błąd odczytu turnieju." });
    }
  }
}
