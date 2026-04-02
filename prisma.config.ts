import "dotenv/config";
import { defineConfig } from "@prisma/config";

// Lokalnie: `dotenv` wczytuje `.env` przed `migrate` / `generate` / `validate`.
// W prod zmienne i tak mogą być wstrzyknięte przez runtime (Docker) — wtedy .env nie jest wymagany.

if (!process.env.DATABASE_URL) {
  throw new Error(
    "KRYTYCZNY BŁĄD ARCHITEKTURY: Brak zmiennej DATABASE_URL. Utwórz plik .env w katalogu głównym (wg .env.example) lub ustaw zmienną w shellu.",
  );
}

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL,
  },
});