import { defineConfig } from '@prisma/config';
import 'dotenv/config';

if (!process.env.DATABASE_URL) {
  throw new Error("KRYTYCZNY BŁĄD ARCHITEKTURY: Brak zmiennej DATABASE_URL w pliku .env. Skonfiguruj połączenie z bazą danych przed uruchomieniem silnika!");
}

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
