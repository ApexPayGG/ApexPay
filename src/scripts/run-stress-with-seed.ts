/**
 * Uruchamia seed (stdout = JSON z matchId, winnerId), potem wybrany skrypt stress z tymi zmiennymi.
 * Działa na Windows i Unix (bez bash $(...)).
 *
 * Użycie: npx tsx src/scripts/run-stress-with-seed.ts db-locks|idempotency
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDir, "..", "..");

const mode = process.argv[2] ?? "db-locks";
const stressScript =
  mode === "idempotency"
    ? join(projectRoot, "src", "scripts", "stress-test-idempotency.ts")
    : join(projectRoot, "src", "scripts", "stress-test-db-locks.ts");

const seedPath = join(projectRoot, "src", "scripts", "seed-disputed-match.ts");

const seed = spawnSync("npx", ["tsx", seedPath], {
  cwd: projectRoot,
  encoding: "utf-8",
  shell: true,
  env: process.env,
});

if (seed.status !== 0) {
  if (seed.stderr.length > 0) {
    process.stderr.write(seed.stderr);
  }
  process.exit(seed.status ?? 1);
}

const out = seed.stdout.trim();
let parsed: { matchId: string; winnerId: string };
try {
  parsed = JSON.parse(out) as { matchId: string; winnerId: string };
} catch {
  console.error(
    "[run-stress-with-seed] Oczekiwano jednej linii JSON ze skryptu seed (matchId, winnerId). Otrzymano:",
    out,
  );
  process.exit(1);
}

if (
  typeof parsed.matchId !== "string" ||
  typeof parsed.winnerId !== "string" ||
  parsed.matchId.length === 0 ||
  parsed.winnerId.length === 0
) {
  console.error("[run-stress-with-seed] Nieprawidłowy payload ze seed:", parsed);
  process.exit(1);
}

const env = {
  ...process.env,
  STRESS_MATCH_ID: parsed.matchId,
  STRESS_FINAL_WINNER_ID: parsed.winnerId,
};

const stress = spawnSync("npx", ["tsx", stressScript], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
  shell: true,
});

process.exit(stress.status ?? 0);
