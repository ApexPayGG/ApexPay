/**
 * Ekstremalny test obciążeniowy: POST /api/v1/matches/:id/resolve
 *
 * Uruchomienie: npx tsx src/scripts/stress-test-idempotency.ts
 * Wymaga: STRESS_JWT (Bearer), opcjonalnie STRESS_BASE_URL, STRESS_MATCH_ID, …
 *
 * Weryfikacja DB: DATABASE_URL + liczba zdarzeń Outbox FUNDS_SETTLED dla matchId
 * (jedno rozliczenie = +1 wiersz). STRESS_SKIP_DB_VERIFY=1 pomija (tylko HTTP).
 */
import "dotenv/config";
import pg from "pg";
const PARALLEL = 500;
/** Stałe dla całego przebiegu (nadpisz przez env). */
const STATIC_MATCH_ID = process.env.STRESS_MATCH_ID ?? "stress-idempotency-match-static";
const STATIC_IDEMPOTENCY_KEY = process.env.STRESS_IDEMPOTENCY_KEY ?? "stress-idempotency-key-static-v1";
const BASE_URL = (process.env.STRESS_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const FINAL_WINNER_ID = process.env.STRESS_FINAL_WINNER_ID ?? "stress-winner-static";
async function countFundsSettledForMatch(pool, matchId) {
    const r = await pool.query(`SELECT COUNT(*)::int AS c FROM "OutboxEvent"
     WHERE "eventType" = $1 AND payload->>'matchId' = $2`, ["FUNDS_SETTLED", matchId]);
    const row = r.rows[0];
    return row?.c ?? 0;
}
function formatTable(statusCounts, timesMs) {
    const lines = [];
    lines.push("");
    lines.push("┌─────────┬────────────┐");
    lines.push("│  HTTP   │   Ilość    │");
    lines.push("├─────────┼────────────┤");
    const sorted = [...statusCounts.entries()].sort((a, b) => a[0] - b[0]);
    for (const [code, n] of sorted) {
        const label = code === 0 ? "ERR/NET" : String(code);
        lines.push(`│ ${label.padEnd(7)} │ ${String(n).padStart(10)} │`);
    }
    lines.push("└─────────┴────────────┘");
    if (timesMs.length > 0) {
        const sum = timesMs.reduce((a, b) => a + b, 0);
        const min = Math.min(...timesMs);
        const max = Math.max(...timesMs);
        const avg = sum / timesMs.length;
        lines.push("");
        lines.push("Czas odpowiedzi (ms):");
        lines.push(`  min: ${min.toFixed(2)}`);
        lines.push(`  max: ${max.toFixed(2)}`);
        lines.push(`  avg: ${avg.toFixed(2)}`);
    }
    return lines.join("\n");
}
async function singleRequest(jwt) {
    const t0 = performance.now();
    try {
        const res = await fetch(`${BASE_URL}/api/v1/matches/${encodeURIComponent(STATIC_MATCH_ID)}/resolve`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${jwt}`,
                "Idempotency-Key": STATIC_IDEMPOTENCY_KEY,
            },
            body: JSON.stringify({ finalWinnerId: FINAL_WINNER_ID }),
        });
        const ms = performance.now() - t0;
        return { status: res.status, ms };
    }
    catch {
        const ms = performance.now() - t0;
        return { status: 0, ms };
    }
}
async function main() {
    const jwt = process.env.STRESS_JWT?.trim();
    if (jwt === undefined || jwt.length === 0) {
        console.error("[stress] Ustaw STRESS_JWT (Bearer token użytkownika z uprawnieniami).");
        process.exit(1);
    }
    const skipDb = process.env.STRESS_SKIP_DB_VERIFY === "1";
    const databaseUrl = process.env.DATABASE_URL?.trim();
    let pool = null;
    let outboxBefore = 0;
    if (!skipDb) {
        if (databaseUrl === undefined || databaseUrl.length === 0) {
            console.error("[stress] Ustaw DATABASE_URL (lub STRESS_SKIP_DB_VERIFY=1 aby pominąć weryfikację Outbox).");
            process.exit(1);
        }
        pool = new pg.Pool({ connectionString: databaseUrl });
        outboxBefore = await countFundsSettledForMatch(pool, STATIC_MATCH_ID);
    }
    console.info(`[stress] ${PARALLEL} równoległych POST, matchId=${STATIC_MATCH_ID}, Idempotency-Key=${STATIC_IDEMPOTENCY_KEY}`);
    const batch = Array.from({ length: PARALLEL }, () => singleRequest(jwt));
    const results = await Promise.all(batch);
    const statusCounts = new Map();
    const timesMs = [];
    for (const r of results) {
        statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
        timesMs.push(r.ms);
    }
    console.info(formatTable(statusCounts, timesMs));
    const ok200 = statusCounts.get(200) ?? 0;
    const conflict409 = statusCounts.get(409) ?? 0;
    const netErr = statusCounts.get(0) ?? 0;
    let otherHttp = 0;
    for (const [code, n] of statusCounts) {
        if (code !== 0 && code !== 200 && code !== 409) {
            otherHttp += n;
        }
    }
    console.info("");
    console.info(`[stress] Podsumowanie HTTP: 200=${ok200}, 409=${conflict409}, inne kody=${otherHttp}, błąd sieci=${netErr}`);
    if (pool !== null) {
        const outboxAfter = await countFundsSettledForMatch(pool, STATIC_MATCH_ID);
        const deltaOutbox = outboxAfter - outboxBefore;
        console.info(`[stress] Outbox FUNDS_SETTLED (matchId): przed=${outboxBefore}, po=${outboxAfter}, delta=${deltaOutbox}`);
        await pool.end();
        if (deltaOutbox > 1) {
            console.error("[stress] BŁĄD: więcej niż jedno rozliczenie w bazie (delta Outbox > 1).");
            process.exit(1);
        }
    }
    else {
        console.warn("[stress] Pominięto weryfikację bazy (STRESS_SKIP_DB_VERIFY=1).");
    }
    console.info("[stress] Zakończono.");
}
void main().catch((e) => {
    console.error("[stress]", e);
    process.exit(1);
});
//# sourceMappingURL=stress-test-idempotency.js.map