/**
 * Sprawdza obecność kluczowych zmiennych środowiskowych (bez logowania wartości).
 * Użycie: npm run ops:check-env
 *         npm run ops:check-env -- --env-file=.env.prod
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const envFileArg = args.find((a) => a.startsWith("--env-file="));
const envPath = envFileArg?.split("=", 2)[1];

if (envPath !== undefined) {
  const p = resolve(envPath);
  if (!existsSync(p)) {
    console.error(`[ops:check-env] Plik nie istnieje: ${p}`);
    process.exit(2);
  }
  config({ path: p });
} else {
  config();
}

type Check = { name: string; optional?: boolean; prodRecommended?: boolean };

const checks: Check[] = [
  { name: "DATABASE_URL" },
  { name: "JWT_SECRET" },
  { name: "REDIS_URL", optional: true },
  { name: "RABBITMQ_URL", optional: true },
  { name: "PSP_DEPOSIT_WEBHOOK_SECRET", optional: true, prodRecommended: true },
  { name: "API_DOMAIN", optional: true, prodRecommended: true },
  { name: "APP_DOMAIN", optional: true, prodRecommended: true },
  { name: "APEXPAY_WEB_IMAGE", optional: true, prodRecommended: true },
  { name: "CORS_ORIGIN", optional: true, prodRecommended: true },
];

function isSet(name: string): boolean {
  const v = process.env[name]?.trim();
  return v !== undefined && v.length > 0;
}

let failed = false;
const isProd = process.env.NODE_ENV === "production";
const envFileLooksProd =
  envPath !== undefined &&
  (envPath.includes(".env.prod") || envPath.endsWith("prod"));
const treatAsProd = isProd || envFileLooksProd;

for (const c of checks) {
  const ok = isSet(c.name);
  if (!ok && !c.optional) {
    console.error(`[ops:check-env] BRAK (wymagane): ${c.name}`);
    failed = true;
  } else if (!ok && c.optional) {
    const tag = c.prodRecommended && treatAsProd ? "zalecane w prod" : "opcjonalne";
    // stdout (nie stderr), żeby kolejność komunikatów była przewidywalna w CI / Windows
    console.log(`[ops:check-env] Pominięte (${tag}): ${c.name}`);
  } else if (ok) {
    console.log(`[ops:check-env] OK: ${c.name}`);
  }
}

if (treatAsProd && !isSet("PSP_DEPOSIT_WEBHOOK_SECRET")) {
  console.log(
    "[ops:check-env] Uwaga (prod): PSP_DEPOSIT_WEBHOOK_SECRET — webhook wpłat będzie zwracał 503.",
  );
}

if (failed) {
  console.error("[ops:check-env] Zakończono błędem.");
  process.exit(1);
}

console.log("[ops:check-env] Wszystkie wymagane zmienne są ustawione.");
