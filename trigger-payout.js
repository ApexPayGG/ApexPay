/**
 * Wstrzykuje minimalny stan (turniej + mecz DISPUTED + uczestnik) i wywołuje POST /api/matches/:id/resolve.
 * Wymaga: DATABASE_URL, JWT_SECRET w .env oraz działającego API (npm start) i wcześniejszego ws-runner (użytkownik w bazie).
 */
import "dotenv/config";
import jwt from "jsonwebtoken";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("Brak DATABASE_URL w .env");
}
const jwtSecret = process.env.JWT_SECRET;
if (jwtSecret === undefined || jwtSecret.length === 0) {
  throw new Error("Brak JWT_SECRET w .env");
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function trigger() {
  try {
    console.log("⚙️  Budowanie stanu bazy danych…");

    const winner = await prisma.user.findFirst({
      orderBy: { createdAt: "desc" },
    });
    if (!winner) {
      throw new Error("Brak gracza. Odpal najpierw ws-runner.js");
    }

    let wallet = await prisma.wallet.findUnique({ where: { userId: winner.id } });
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { userId: winner.id, balance: 0n },
      });
    }

    const registrationEndsAt = new Date(Date.now() + 86_400_000);

    const tournament = await prisma.tournament.create({
      data: {
        title: "Automatyczny Test Escrow",
        entryFee: 50n,
        maxPlayers: 8,
        registrationEndsAt,
        minLevel: 1,
        organizerId: winner.id,
        status: "IN_PROGRESS",
      },
    });

    await prisma.tournamentParticipant.create({
      data: {
        tournamentId: tournament.id,
        userId: winner.id,
      },
    });

    const match = await prisma.match.create({
      data: {
        tournamentId: tournament.id,
        status: "DISPUTED",
      },
    });

    console.log(`✅ Stan gotowy. Wygenerowano mecz ID: ${match.id}`);
    console.log("🚀 Uderzenie w endpoint rozliczeniowy…");

    const token = jwt.sign({ userId: winner.id }, jwtSecret, { expiresIn: "24h" });

    const response = await fetch(
      `http://localhost:3000/api/matches/${match.id}/resolve`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `jwt=${token}`,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ finalWinnerId: winner.id }),
      },
    );

    const raw = await response.text();
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      result = raw;
    }
    console.log("🎯 Odpowiedź silnika API:", response.status, result);
  } catch (error) {
    console.error(
      "❌ Błąd egzekucji:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

trigger();
