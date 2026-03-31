import { defineConfig } from '@prisma/config';

// Architektura Cloud-Native: usunięto import 'dotenv/config'.
// W środowisku produkcyjnym (Hetzner) zmienne środowiskowe są wstrzykiwane 
// bezpośrednio do pamięci procesu przez silnik Dockera.

if (!process.env.DATABASE_URL) {
  throw new Error("KRYTYCZNY BŁĄD ARCHITEKTURY: Brak zmiennej DATABASE_URL w środowisku. Skonfiguruj połączenie z bazą danych przed uruchomieniem silnika ApexPay!");
}

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL,
  },
});