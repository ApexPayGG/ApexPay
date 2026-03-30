/**
 * Test odporności na race condition / double-spending: POST /api/v1/matches/:id/resolve
 * z losowym Idempotency-Key na żądanie (bypass Redis) — presja na FOR UPDATE w PostgreSQL.
 *
 * Uruchomienie: npm run stress:db-locks
 * Wymaga: STRESS_JWT, DATABASE_URL (lub STRESS_SKIP_DB_VERIFY=1)
 */
import "dotenv/config";
//# sourceMappingURL=stress-test-db-locks.d.ts.map