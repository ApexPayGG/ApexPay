/**
 * Wspólna konfiguracja scenariuszy k6 (TypeScript).
 * Wartości z ENV — patrz load-tests/README.md.
 */

/** Bazowy URL API (bez końcowego `/`). */
export function getBaseUrl(): string {
  const raw = __ENV.BASE_URL ?? __ENV.K6_BASE_URL ?? "http://localhost:3000";
  const t = raw.trim();
  return t.endsWith("/") ? t.slice(0, -1) : t;
}

export const LOAD_PASSWORD = "LoadTestPass123!";

export function getAutopayServiceId(): string {
  const v = __ENV.AUTOPAY_SERVICE_ID?.trim();
  if (v === undefined || v.length === 0) {
    throw new Error("AUTOPAY_SERVICE_ID is required for ITN hash (must match API server env).");
  }
  return v;
}

export function getAutopaySharedKey(): string {
  const v = __ENV.AUTOPAY_SHARED_KEY?.trim();
  if (v === undefined || v.length === 0) {
    throw new Error("AUTOPAY_SHARED_KEY is required for ITN hash (must match API server env).");
  }
  return v;
}

export function getAdminEmail(): string {
  const v = __ENV.LOAD_ADMIN_EMAIL?.trim();
  if (v === undefined || v.length === 0) {
    throw new Error("LOAD_ADMIN_EMAIL is required for this scenario (ADMIN account).");
  }
  return v;
}

export function getAdminPassword(): string {
  const v = __ENV.LOAD_ADMIN_PASSWORD?.trim();
  if (v === undefined || v.length === 0) {
    throw new Error("LOAD_ADMIN_PASSWORD is required for this scenario (ADMIN account).");
  }
  return v;
}

/** Progi domyślne — scenariusze mogą je rozszerzać w `options.thresholds`. */
export const defaultThresholds = {
  /** Płatność pasażera — ścisłe SLA */
  paymentFlow: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    http_req_failed: ["rate<0.01"],
  },
  /** Marketplace charge — tolerancja rate limit */
  concurrentCharges: {
    charge_duration: ["p(95)<1000"],
    errors_5xx: ["rate<0.001"],
    saw_429: ["count>0"],
  },
  webhookStorm: {
    itn_ok: ["rate>0.99"],
    http_5xx: ["count<1"],
  },
  fraud: {
    charge_duration: ["p(95)<800"],
  },
} as const;
