/**
 * Automatyczny runner: rejestracja → login → WebSocket z JWT → nasłuch PAYOUT_RECEIVED
 * Uruchomienie: node ws-runner.js (serwer API musi działać na http://localhost:3000)
 */

import { io } from "socket.io-client";

const BASE = "http://localhost:3000";

function httpError(step, res, body) {
  const detail =
    typeof body === "string"
      ? body
      : body !== null && typeof body === "object"
        ? JSON.stringify(body)
        : String(body);
  return new Error(`[${step}] HTTP ${res.status} ${res.statusText}: ${detail}`);
}

/** JWT z JSON lub z nagłówka Set-Cookie (jwt=...) */
function extractToken(loginRes, loginBody) {
  if (
    loginBody &&
    typeof loginBody.token === "string" &&
    loginBody.token.length > 0
  ) {
    return loginBody.token;
  }
  const getSetCookie = loginRes.headers.getSetCookie?.bind(loginRes.headers);
  if (typeof getSetCookie === "function") {
    for (const line of getSetCookie()) {
      const m = /^jwt=([^;]+)/.exec(line);
      if (m) {
        return decodeURIComponent(m[1]);
      }
    }
  }
  const single = loginRes.headers.get("set-cookie");
  if (single) {
    const m = /jwt=([^;]+)/.exec(single);
    if (m) {
      return decodeURIComponent(m[1]);
    }
  }
  return null;
}

async function main() {
  const stamp = Date.now();
  const email = `ws_runner_${stamp}@example.test`;
  const password = "WsRunnerValidPass12!";

  console.log("[1/4] POST /api/auth/register …");
  const regRes = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  let regBody;
  try {
    regBody = await regRes.json();
  } catch {
    regBody = null;
  }
  if (!regRes.ok) {
    throw httpError("register", regRes, regBody);
  }
  if (!regBody?.id || typeof regBody.id !== "string") {
    throw new Error("[register] Oczekiwano pola id (string) w JSON.");
  }
  console.log(`  → Użytkownik utworzony, id=${regBody.id}`);

  console.log("[2/4] POST /api/auth/login …");
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  let loginBody;
  try {
    loginBody = await loginRes.json();
  } catch {
    loginBody = null;
  }
  if (!loginRes.ok) {
    throw httpError("login", loginRes, loginBody);
  }
  if (!loginBody?.id || typeof loginBody.id !== "string") {
    throw new Error("[login] Oczekiwano pola id (string) w JSON.");
  }

  const token = extractToken(loginRes, loginBody);
  if (!token) {
    throw new Error(
      "[login] Brak JWT: ani token w JSON, ani ciasteczka jwt w Set-Cookie.",
    );
  }
  console.log(`  → Zalogowano, user.id=${loginBody.id}, token (długość)=${token.length}`);

  console.log("[3/4] Socket.IO →", BASE);
  const socket = io(BASE, {
    auth: { token },
    transports: ["websocket", "polling"],
  });

  socket.on("connect", () => {
    console.log(
      `[4/4] ✅ Połączono (socket.id=${socket.id}). Nasłuch: PAYOUT_RECEIVED (Ctrl+C aby zakończyć).`,
    );
  });

  socket.on("PAYOUT_RECEIVED", (payload) => {
    console.log("\n💰 PAYOUT_RECEIVED");
    console.log(JSON.stringify(payload, null, 2));
  });

  socket.on("connect_error", (err) => {
    console.error("❌ connect_error:", err.message);
    process.exitCode = 1;
  });

  socket.on("disconnect", (reason) => {
    console.log("ℹ️ Rozłączono:", reason);
  });
}

main().catch((err) => {
  console.error("❌ ws-runner:", err instanceof Error ? err.message : err);
  process.exit(1);
});
