import http from "k6/http";
import type { Response } from "k6/http";
import { LOAD_PASSWORD, getBaseUrl } from "../config";
import { buildAutopayItnFormBody, buildItnXml } from "./autopay-itn";

export type AuthSession = {
  userId: string;
  email: string;
  jwt: string;
};

export type IntegratorReady = AuthSession & {
  apiKey: string;
  connectedAccountId: string;
};

function jsonHeaders(jwt?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (jwt !== undefined) {
    h.Authorization = `Bearer ${jwt}`;
  }
  return h;
}

function mustOk(res: Response, step: string): void {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${step}: HTTP ${res.status} — ${String(res.body).slice(0, 500)}`);
  }
}

export function registerUser(baseUrl: string, email: string, password: string = LOAD_PASSWORD): void {
  const res = http.post(
    `${baseUrl}/api/v1/auth/register`,
    JSON.stringify({ email, password }),
    { headers: jsonHeaders() },
  );
  if (res.status !== 201 && res.status !== 409) {
    throw new Error(`register ${email}: HTTP ${res.status} — ${String(res.body).slice(0, 300)}`);
  }
}

export function loginUser(baseUrl: string, email: string, password: string = LOAD_PASSWORD): AuthSession {
  const res = http.post(
    `${baseUrl}/api/v1/auth/login`,
    JSON.stringify({ email, password }),
    { headers: jsonHeaders() },
  );
  mustOk(res, `login ${email}`);
  const j = JSON.parse(res.body as string) as { token?: string; id?: string; email?: string };
  if (typeof j.token !== "string" || typeof j.id !== "string") {
    throw new Error(`login: brak token/id w odpowiedzi`);
  }
  return { userId: j.id, email: typeof j.email === "string" ? j.email : email, jwt: j.token };
}

export function adminLogin(baseUrl: string, email: string, password: string): string {
  const res = http.post(
    `${baseUrl}/api/v1/auth/login`,
    JSON.stringify({ email, password }),
    { headers: jsonHeaders() },
  );
  mustOk(res, "admin login");
  const j = JSON.parse(res.body as string) as { token?: string };
  if (typeof j.token !== "string") {
    throw new Error("admin login: brak token");
  }
  return j.token;
}

export function adminFundWallet(baseUrl: string, adminJwt: string, targetUserId: string, amountCents: string): void {
  const res = http.post(
    `${baseUrl}/api/v1/wallet/fund`,
    JSON.stringify({ targetUserId, amount: amountCents }),
    { headers: jsonHeaders(adminJwt) },
  );
  mustOk(res, "wallet/fund");
}

export function adminCreateConnectedAccount(baseUrl: string, adminJwt: string, userId: string): string {
  const res = http.post(
    `${baseUrl}/api/v1/connected-accounts`,
    JSON.stringify({ userId }),
    { headers: jsonHeaders(adminJwt) },
  );
  mustOk(res, "connected-accounts create");
  const j = JSON.parse(res.body as string) as { data?: { connectedAccountId?: string } };
  const id = j.data?.connectedAccountId;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("connected-accounts: brak connectedAccountId");
  }
  return id;
}

export function adminActivateConnectedAccount(baseUrl: string, adminJwt: string, accountId: string): void {
  const res = http.patch(
    `${baseUrl}/api/v1/connected-accounts/${accountId}`,
    JSON.stringify({ status: "ACTIVE" }),
    { headers: jsonHeaders(adminJwt) },
  );
  mustOk(res, "connected-accounts patch ACTIVE");
}

export function createApiKeyForUser(baseUrl: string, userJwt: string, name: string): string {
  const res = http.post(
    `${baseUrl}/api/v1/api-keys`,
    JSON.stringify({ name }),
    { headers: jsonHeaders(userJwt) },
  );
  mustOk(res, "api-keys create");
  const j = JSON.parse(res.body as string) as { data?: { key?: string } };
  const key = j.data?.key;
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("api-keys: brak pola data.key");
  }
  return key;
}

export function postIntegrationCharge(
  baseUrl: string,
  apiKey: string,
  idempotencyKey: string,
  connectedAccountId: string,
  amountCents: number,
  splitCents: number,
): Response {
  const body = JSON.stringify({
    amount: amountCents,
    currency: "PLN",
    splits: [{ connectedAccountId, amount: splitCents }],
  });
  return http.post(`${baseUrl}/api/v1/integrations/charges`, body, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-api-key": apiKey,
      "Idempotency-Key": idempotencyKey,
    },
  });
}

export function postPaymentsInitiate(
  baseUrl: string,
  passengerJwt: string,
  amountCents: number,
  description: string,
): Response {
  return http.post(
    `${baseUrl}/api/v1/payments/initiate`,
    JSON.stringify({
      amount: amountCents,
      currency: "PLN",
      description,
    }),
    { headers: jsonHeaders(passengerJwt) },
  );
}

export function getIntegratorCharges(baseUrl: string, apiKey: string): Response {
  return http.get(`${baseUrl}/api/v1/integrations/charges?limit=20`, {
    headers: { Accept: "application/json", "x-api-key": apiKey },
  });
}

export function postAutopayItn(baseUrl: string, xml: string): Response {
  const form = buildAutopayItnFormBody(xml);
  return http.post(`${baseUrl}/internal/webhooks/autopay-itn`, form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

export function itnSuccessXml(params: {
  serviceId: string;
  sharedKey: string;
  orderId: string;
  remoteId: string;
  amountMajor: string;
  currency: string;
}): string {
  return buildItnXml({
    serviceId: params.serviceId,
    orderId: params.orderId,
    remoteId: params.remoteId,
    amountMajor: params.amountMajor,
    currency: params.currency,
    status: "SUCCESS",
    sharedKey: params.sharedKey,
  });
}

export function getWalletBalanceString(baseUrl: string, jwt: string): string {
  const res = http.get(`${baseUrl}/api/v1/wallet/me`, { headers: jsonHeaders(jwt) });
  mustOk(res, "wallet/me");
  const j = JSON.parse(res.body as string) as { balance?: string };
  if (typeof j.balance !== "string") {
    throw new Error("wallet/me: brak balance");
  }
  return j.balance;
}

const rand = () => Math.random().toString(36).slice(2, 10);

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${rand()}@load.apexpay.test`.toLowerCase();
}

/** Pełny bootstrap integratora pod marketplace charge (wymaga konta ADMIN). */
export function bootstrapMarketplaceIntegrator(
  adminJwt: string,
  tag: string,
): IntegratorReady {
  const baseUrl = getBaseUrl();
  const email = uniqueEmail(`int-${tag}`);
  registerUser(baseUrl, email, LOAD_PASSWORD);
  const session = loginUser(baseUrl, email, LOAD_PASSWORD);
  adminFundWallet(baseUrl, adminJwt, session.userId, "50000000");
  const ca = adminCreateConnectedAccount(baseUrl, adminJwt, session.userId);
  adminActivateConnectedAccount(baseUrl, adminJwt, ca);
  const apiKey = createApiKeyForUser(baseUrl, session.jwt, `load-${tag}-${rand()}`);
  return { ...session, apiKey, connectedAccountId: ca };
}

export function prewarmIntegrationCharges(
  apiKey: string,
  connectedAccountId: string,
  count: number,
  prefix: string,
): void {
  const baseUrl = getBaseUrl();
  for (let i = 0; i < count; i++) {
    const res = postIntegrationCharge(baseUrl, apiKey, `${prefix}-w-${i}`, connectedAccountId, 100, 50);
    if (res.status !== 201 && res.status !== 409) {
      throw new Error(`prewarm charge ${i}: HTTP ${res.status} ${String(res.body).slice(0, 200)}`);
    }
  }
}
