/**
 * Przygotowuje izolowany mecz DISPUTED + użytkowników z portfelami dla testów obciążeniowych.
 * Sukces: na stdout TYLKO jedna linia JSON: {"matchId":"...","winnerId":"..."}
 */
import "dotenv/config";
import bcrypt from "bcrypt";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const BCRYPT_ROUNDS = 12;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    console.error(
      "[seed-disputed-match] BŁĄD: Brak DATABASE_URL — ustaw połączenie z PostgreSQL w .env.",
    );
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const passwordHash = await bcrypt.hash(`seed-stress-${suffix}-pwd`, BCRYPT_ROUNDS);

    const result = await prisma.$transaction(async (tx) => {
      const organizer = await tx.user.create({
        data: {
          email: `stress-org-${suffix}@local.test`,
          passwordHash,
          wallet: { create: { balance: 0n } },
        },
      });

      const playerA = await tx.user.create({
        data: {
          email: `stress-pa-${suffix}@local.test`,
          passwordHash,
          wallet: { create: { balance: 10_000n } },
        },
      });

      const playerB = await tx.user.create({
        data: {
          email: `stress-pb-${suffix}@local.test`,
          passwordHash,
          wallet: { create: { balance: 10_000n } },
        },
      });

      const endsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const tournament = await tx.tournament.create({
        data: {
          title: `stress-seed-${suffix}`,
          entryFee: 100n,
          maxPlayers: 2,
          registrationEndsAt: endsAt,
          organizerId: organizer.id,
          status: "IN_PROGRESS",
        },
      });

      await tx.tournamentParticipant.createMany({
        data: [
          { tournamentId: tournament.id, userId: playerA.id },
          { tournamentId: tournament.id, userId: playerB.id },
        ],
      });

      const match = await tx.match.create({
        data: {
          tournamentId: tournament.id,
          status: "DISPUTED",
          winnerId: null,
        },
      });

      return { matchId: match.id, winnerId: playerA.id };
    });

    process.stdout.write(
      `${JSON.stringify({
        matchId: result.matchId,
        winnerId: result.winnerId,
      })}\n`,
    );
    await prisma.$disconnect();
    await pool.end();
  } catch (err: unknown) {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
    console.error(
      "[seed-disputed-match] Błąd zapisu do bazy (sprawdź DATABASE_URL, migracje, unikalność email):",
      msg,
    );
    await prisma.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

void main();
