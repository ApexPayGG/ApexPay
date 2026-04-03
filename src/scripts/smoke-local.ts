/**
 * Local smoke test for auth + wallet endpoints.
 *
 * Usage:
 *   npm run smoke:local
 *   npm run smoke:local:admin
 *   npm run smoke:local:tournament   # wymaga działającego API + DB; pełna ścieżka escrow (create → join → ledger)
 *
 * Optional env:
 *   SMOKE_EMAIL=smoke.user@example.com
 *   SMOKE_PASSWORD=SmokeHaslo123!
 *   API_BASE_URL=http://localhost:3000
 *   SMOKE_FUND_TARGET_USER_ID=cm... (opcjonalnie, domyślnie własne id)
 */

import "dotenv/config";
import bcrypt from "bcrypt";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole } from "@prisma/client";

type JsonRecord = Record<string, unknown>;

function env(name: string, fallback: string): string {
  const v = process.env[name];
  if (typeof v !== "string" || v.trim().length === 0) {
    return fallback;
  }
  return v.trim();
}

const REQUIRE_ADMIN = process.argv.includes("--require-admin");
const RUN_TOURNAMENT = process.argv.includes("--tournament");
const API_BASE_URL = env("API_BASE_URL", "http://localhost:3000");
const SMOKE_EMAIL = env(
  "SMOKE_EMAIL",
  REQUIRE_ADMIN ? "admin@apexpay.pl" : "smoke.user@example.com",
);
const SMOKE_PASSWORD = env(
  "SMOKE_PASSWORD",
  REQUIRE_ADMIN ? "PotezneHasloAdmina!" : "SmokeHaslo123!",
);
const SMOKE_FUND_TARGET_USER_ID = process.env.SMOKE_FUND_TARGET_USER_ID?.trim();
const BCRYPT_ROUNDS = 12;

function url(path: string): string {
  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${base}${path}`;
}

async function postJson(path: string, body: JsonRecord, token?: string): Promise<Response> {
  return fetch(url(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function getJson(path: string, token: string): Promise<Response> {
  return fetch(url(path), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
}

async function readJsonSafe(res: Response): Promise<JsonRecord> {
  const txt = await res.text();
  if (txt.length === 0) return {};
  try {
    return JSON.parse(txt) as JsonRecord;
  } catch {
    return { raw: txt };
  }
}

function assertStatus(res: Response, allowed: number[], payload: JsonRecord, step: string): void {
  if (allowed.includes(res.status)) return;
  throw new Error(`${step} failed: HTTP ${res.status} ${res.statusText} | ${JSON.stringify(payload)}`);
}

async function main(): Promise<void> {
  console.log(`[smoke] API: ${API_BASE_URL}`);
  console.log(`[smoke] User: ${SMOKE_EMAIL}`);
  console.log(
    `[smoke] Mode: ${REQUIRE_ADMIN ? "ADMIN" : "STANDARD"}${RUN_TOURNAMENT ? " +TOURNAMENT" : ""}`,
  );

  if (RUN_TOURNAMENT && !REQUIRE_ADMIN) {
    throw new Error("Użyj: npm run smoke:local:tournament (wymaga --require-admin: fund + turniej + join jako ten sam użytkownik)");
  }

  if (REQUIRE_ADMIN) {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (databaseUrl === undefined || databaseUrl.length === 0) {
      throw new Error("DATABASE_URL is required for --require-admin mode");
    }
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    try {
      const email = SMOKE_EMAIL.trim().toLowerCase();
      const passwordHash = await bcrypt.hash(SMOKE_PASSWORD, BCRYPT_ROUNDS);
      const user = await prisma.user.upsert({
        where: { email },
        update: { passwordHash, role: UserRole.ADMIN },
        create: {
          email,
          passwordHash,
          role: UserRole.ADMIN,
        },
        select: { id: true },
      });
      await prisma.wallet.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, balance: 0n },
      });
      console.log("[smoke] admin account ensured in DB");
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
  } else {
    const registerRes = await postJson("/api/v1/auth/register", {
      email: SMOKE_EMAIL,
      password: SMOKE_PASSWORD,
    });
    const registerPayload = await readJsonSafe(registerRes);
    assertStatus(registerRes, [201, 409], registerPayload, "register");
    console.log(`[smoke] register -> ${registerRes.status}`);
  }

  const loginRes = await postJson("/api/v1/auth/login", {
    email: SMOKE_EMAIL,
    password: SMOKE_PASSWORD,
  });
  const loginPayload = await readJsonSafe(loginRes);
  assertStatus(loginRes, [200], loginPayload, "login");

  const token = loginPayload.token;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error(`login failed: token missing in payload ${JSON.stringify(loginPayload)}`);
  }
  console.log("[smoke] login -> 200");

  const meRes = await getJson("/api/v1/auth/me", token);
  const mePayload = await readJsonSafe(meRes);
  assertStatus(meRes, [200], mePayload, "me");
  const userId = mePayload.id;
  const role = mePayload.role;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error(`me failed: id missing in payload ${JSON.stringify(mePayload)}`);
  }
  console.log(`[smoke] me -> 200 (id=${userId}, role=${String(role)})`);

  const walletRes = await getJson("/api/v1/wallet/me", token);
  const walletPayload = await readJsonSafe(walletRes);
  assertStatus(walletRes, [200], walletPayload, "wallet/me");
  console.log(`[smoke] wallet/me -> 200 (balance=${String(walletPayload.balance ?? "n/a")})`);

  if (REQUIRE_ADMIN && role !== "ADMIN") {
    throw new Error(`expected ADMIN role, got: ${String(role)}`);
  }

  if (role === "ADMIN") {
    const fundTarget = SMOKE_FUND_TARGET_USER_ID && SMOKE_FUND_TARGET_USER_ID.length > 0
      ? SMOKE_FUND_TARGET_USER_ID
      : userId;
    const fundRes = await postJson(
      "/api/v1/wallet/fund",
      { targetUserId: fundTarget, amount: "1000" },
      token,
    );
    const fundPayload = await readJsonSafe(fundRes);
    assertStatus(fundRes, [200], fundPayload, "wallet/fund");
    console.log(
      `[smoke] wallet/fund -> 200 (target=${fundTarget}, newBalance=${String(
        fundPayload.newBalance ?? "n/a",
      )})`,
    );
  } else {
    console.log("[smoke] wallet/fund skipped (requires ADMIN role)");
  }

  if (RUN_TOURNAMENT) {
    const entryFeeCents = "500";
    const createRes = await postJson(
      "/api/tournaments",
      {
        title: `[smoke] ${new Date().toISOString()}`,
        entryFeeCents,
        maxPlayers: 8,
        registrationEndsInHours: 48,
      },
      token,
    );
    const createPayload = await readJsonSafe(createRes);
    assertStatus(createRes, [201], createPayload, "tournaments/create");
    const data = createPayload.data as JsonRecord | undefined;
    const tournamentId =
      data !== undefined && typeof data.tournamentId === "string"
        ? data.tournamentId
        : undefined;
    if (tournamentId === undefined || tournamentId.length === 0) {
      throw new Error(`create tournament: brak data.tournamentId w ${JSON.stringify(createPayload)}`);
    }
    console.log(`[smoke] tournaments/create -> 201 (id=${tournamentId})`);

    const listRes = await getJson("/api/tournaments?limit=10", token);
    const listPayload = await readJsonSafe(listRes);
    assertStatus(listRes, [200], listPayload, "tournaments/list");
    const items = (listPayload.data as JsonRecord | undefined)?.items;
    const inList =
      Array.isArray(items) &&
      items.some(
        (it: unknown) =>
          typeof it === "object" &&
          it !== null &&
          (it as JsonRecord).tournamentId === tournamentId,
      );
    if (!inList) {
      throw new Error(`tournament ${tournamentId} not found in list response`);
    }
    console.log("[smoke] tournaments/list -> 200 (turniej na liście)");

    const walletBeforeJoin = await getJson("/api/v1/wallet/me", token);
    const wBefore = await readJsonSafe(walletBeforeJoin);
    assertStatus(walletBeforeJoin, [200], wBefore, "wallet/me before join");
    const balBefore = BigInt(String(wBefore.balance ?? "0"));

    const joinRes = await postJson(
      `/api/tournaments/${tournamentId}/join`,
      {},
      token,
    );
    const joinPayload = await readJsonSafe(joinRes);
    assertStatus(joinRes, [200], joinPayload, "tournaments/join");
    console.log("[smoke] tournaments/join -> 200 (escrow)");

    const walletAfterJoin = await getJson("/api/v1/wallet/me", token);
    const wAfter = await readJsonSafe(walletAfterJoin);
    assertStatus(walletAfterJoin, [200], wAfter, "wallet/me after join");
    const balAfter = BigInt(String(wAfter.balance ?? "0"));
    const fee = BigInt(entryFeeCents);
    if (balBefore - balAfter !== fee) {
      throw new Error(
        `expected balance drop ${fee}, got before=${balBefore} after=${balAfter}`,
      );
    }
    console.log(`[smoke] wallet balance OK: -${fee} minor units`);

    const txRes = await getJson("/api/v1/admin/transactions?limit=30", token);
    const txPayload = await readJsonSafe(txRes);
    assertStatus(txRes, [200], txPayload, "admin/transactions");
    const txItems = txPayload.items;
    const hasEscrow =
      Array.isArray(txItems) &&
      txItems.some((row: unknown) => {
        if (typeof row !== "object" || row === null) return false;
        const r = row as JsonRecord;
        return (
          r.type === "ESCROW_HOLD" &&
          r.walletUserId === userId &&
          String(r.amount ?? "") === entryFeeCents
        );
      });
    if (!hasEscrow) {
      throw new Error(
        `brak wpisu ESCROW_HOLD dla userId=${userId} amount=${entryFeeCents} w admin/transactions`,
      );
    }
    console.log("[smoke] admin/transactions -> ESCROW_HOLD znaleziony");
  }

  console.log("[smoke] DONE");
}

void main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[smoke] FAILED:", message);
  process.exitCode = 1;
});

