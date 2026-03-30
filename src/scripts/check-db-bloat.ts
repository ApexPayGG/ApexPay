import "dotenv/config";
import { PrismaClient } from "@prisma/client";

type BloatRow = {
  heap_bytes: bigint;
  index_bytes: bigint;
};

/**
 * Diagnostyka rozmiaru heap vs indeksów dla tabeli OutboxEvent (PostgreSQL).
 * Duży stosunek indeksów do heap może wskazywać na bloat — rozważ VACUUM ANALYZE / REINDEX.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.trim().length === 0) {
    console.error("[db:check-bloat] Brak DATABASE_URL.");
    process.exit(1);
  }

  const prisma = new PrismaClient();

  const sql = `
    SELECT
      COALESCE(pg_table_size(c.oid), 0)::bigint AS heap_bytes,
      COALESCE(pg_indexes_size(c.oid), 0)::bigint AS index_bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'OutboxEvent'
      AND c.relkind = 'r'
    LIMIT 1
  `;

  try {
    const rows = await prisma.$queryRawUnsafe<BloatRow[]>(sql);
    const row = rows[0];
    if (row === undefined) {
      console.warn(
        '[db:check-bloat] Nie znaleziono tabeli "OutboxEvent" w schemacie public (brak migracji?).',
      );
      return;
    }

    const heap = Number(row.heap_bytes);
    const idx = Number(row.index_bytes);
    const heapPretty = (heap / 1024 / 1024).toFixed(2);
    const idxPretty = (idx / 1024 / 1024).toFixed(2);

    console.log(
      `[db:check-bloat] OutboxEvent — heap: ~${heapPretty} MiB, indeksy: ~${idxPretty} MiB`,
    );

    if (heap === 0) {
      console.warn(
        "[db:check-bloat] Heap tabeli = 0 — pusta tabela lub brak danych; wskaźnik indeks/heap niewiarygodny.",
      );
      return;
    }

    const ratio = idx / heap;
    if (ratio > 2.5) {
      console.warn(
        `[db:check-bloat] OSTRZEŻENIE: suma indeksów (~${idxPretty} MiB) jest ~${ratio.toFixed(1)}× większa niż heap tabeli (~${heapPretty} MiB).`,
      );
      console.warn(
        "[db:check-bloat] Możliwy bloat / martwe krotki — rozważ: VACUUM ANALYZE \"OutboxEvent\"; w ciężkich przypadkach REINDEX na indeksach lub oknie serwisowym.",
      );
    } else {
      console.log("[db:check-bloat] Stosunek indeks/heap w normie (próg ostrzeżenia: > 2.5×).");
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: unknown) => {
  console.error("[db:check-bloat]", e);
  process.exit(1);
});
