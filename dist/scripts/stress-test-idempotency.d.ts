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
//# sourceMappingURL=stress-test-idempotency.d.ts.map