import { io } from "socket.io-client";

// UWAGA: Token JWT zostanie uzupełniony ręcznie przez administratora
const TOKEN = "TUTAJ_WKLEJ_SWOJ_TOKEN_JWT";

console.log("⏳ Nawiązywanie szyfrowanego połączenia z silnikiem ApexPay...");

const socket = io("http://localhost:3000", {
  auth: { token: TOKEN },
});

socket.on("connect", () => {
  console.log(`✅ Kanał zabezpieczony (ID: ${socket.id}). Nasłuchiwanie na strumień finansowy...`);
});

socket.on("PAYOUT_RECEIVED", (payload) => {
  console.log("\n💰 [ALARM BIZNESOWY] WPŁYNĘŁY ŚRODKI Z ESCROW!");
  console.log("Dane transakcji:", JSON.stringify(payload, null, 2));
});

socket.on("connect_error", (err) => {
  console.error("❌ Odrzucono połączenie:", err.message);
});
