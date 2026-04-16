const TOKEN_KEY = "skillgaming_token";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type LoginResponse = {
  token: string;
  id: string;
  email: string;
  role: string;
};

export type MeResponse = {
  id: string;
  email: string;
  role: string;
};

export type WalletResponse = {
  balance: string;
};

export type Tournament = {
  tournamentId: string;
  title: string;
  entryFeeCents: string;
  maxPlayers: number;
  currentPlayers: number;
  status: string;
  registrationEndsAt: string;
  createdAt: string;
};

export type TournamentListResponse = {
  data: {
    items: Tournament[];
    nextCursor?: string;
  };
};

export type CreateTournamentInput = {
  title: string;
  entryFeeCents: number;
  maxPlayers: number;
  registrationEndsInHours: number;
};

export type UserWallet = {
  userId: string;
  email: string;
  role: string;
  walletId: string | null;
  balance: string;
  createdAt: string;
};

export type UsersListResponse = {
  items: UserWallet[];
  total: number;
};

export type InitiatePaymentResponse = {
  paymentUrl: string;
  orderId: string;
};

export type ApiEnvelope<T> = {
  status: string;
  data: T;
};

export type TradeStatus =
  | "PENDING_PAYMENT"
  | "PAID_AWAITING_ITEM"
  | "COMPLETED"
  | "CANCELLED"
  | "DISPUTED";

export type TradeDetail = {
  tradeId: string;
  sellerId: string;
  buyerId: string | null;
  itemName: string;
  description: string | null;
  amountCents: string;
  platformFeeCents: string;
  status: TradeStatus;
  sellerEmail: string;
  expiresAt: string | null;
  createdAt: string;
};

export type TradeListItem = {
  tradeId: string;
  itemName: string;
  status: TradeStatus;
  amountCents: string;
  createdAt: string;
  expiresAt: string | null;
};

export type CreateTradeInput = {
  itemName: string;
  amountCents: number;
  description?: string;
};

export type CreateTradeResult = {
  tradeId: string;
  tradeLink: string;
};

function normalizedBase(): string {
  const raw = import.meta.env.VITE_API_URL;
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) {
    return "";
  }
  return new URL(value).origin;
}

export function apiUrl(path: string): string {
  const safePath = path.startsWith("/") ? path : `/${path}`;
  const base = normalizedBase();
  if (base.length === 0) {
    return safePath;
  }
  return new URL(safePath, base).toString();
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers ?? undefined);
  headers.set("Accept", "application/json");
  if (token !== null && token.length > 0) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
  });

  const text = await response.text();
  const payload = text.length > 0 ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
          ? payload.error
          : response.statusText || "Request failed";
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const data = await request<LoginResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  saveToken(data.token);
  return data;
}

export async function register(email: string, password: string): Promise<void> {
  await request<unknown>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function getMe(): Promise<MeResponse> {
  return request<MeResponse>("/api/v1/auth/me");
}

export function logout(): void {
  clearToken();
}

export function getWallet(): Promise<WalletResponse> {
  return request<WalletResponse>("/api/v1/wallet/me");
}

export function listTournaments(limit?: number, cursor?: string): Promise<TournamentListResponse> {
  const params = new URLSearchParams();
  if (typeof limit === "number") {
    params.set("limit", String(limit));
  }
  if (typeof cursor === "string" && cursor.length > 0) {
    params.set("cursor", cursor);
  }
  const query = params.toString();
  const path = query.length > 0 ? `/api/tournaments?${query}` : "/api/tournaments";
  return request<TournamentListResponse>(path);
}

export function createTournament(
  input: CreateTournamentInput,
): Promise<{ data: { tournamentId: string } }> {
  return request<{ data: { tournamentId: string } }>("/api/tournaments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function joinTournament(tournamentId: string): Promise<void> {
  await request<unknown>(`/api/tournaments/${encodeURIComponent(tournamentId)}/join`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function fundWallet(amount: number): Promise<void> {
  // Wymaga ADMIN — tylko do testów deweloperskich
  await request("/api/v1/wallet/fund", {
    method: "POST",
    body: JSON.stringify({ amount: String(amount) }),
  });
}

export async function adminGetUsers(): Promise<UsersListResponse> {
  return request<UsersListResponse>("/api/v1/admin/users-wallets");
}

export async function adminFundWallet(targetUserId: string, amount: number): Promise<void> {
  await request("/api/v1/wallet/fund", {
    method: "POST",
    body: JSON.stringify({
      targetUserId,
      amount: String(amount),
    }),
  });
}

export async function depositFunds(amount: number): Promise<{ redirectUrl: string }> {
  return request("/api/v1/payments/deposit", {
    method: "POST",
    body: JSON.stringify({ amountCents: amount * 100 }),
  });
}

export async function initiateDeposit(amountCents: number): Promise<InitiatePaymentResponse> {
  const data = await request<{ status: string; data: InitiatePaymentResponse }>(
    "/api/v1/payments/initiate",
    {
      method: "POST",
      body: JSON.stringify({
        amount: amountCents,
        currency: "PLN",
        description: "Doładowanie portfela SkillGaming",
      }),
    },
  );
  return data.data;
}

export async function createTrade(input: CreateTradeInput): Promise<CreateTradeResult> {
  const body: Record<string, unknown> = {
    itemName: input.itemName.trim(),
    amountCents: input.amountCents,
  };
  if (input.description !== undefined && input.description.trim().length > 0) {
    body.description = input.description.trim();
  }
  const res = await request<ApiEnvelope<CreateTradeResult>>("/api/v1/trades", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function listMyTrades(limit = 20): Promise<{ items: TradeListItem[] }> {
  const params = new URLSearchParams({
    seller: "me",
    limit: String(limit),
  });
  const res = await request<ApiEnvelope<{ items: TradeListItem[] }>>(`/api/v1/trades?${params.toString()}`);
  return res.data;
}

export async function getTrade(tradeId: string): Promise<TradeDetail> {
  const res = await request<ApiEnvelope<TradeDetail>>(
    `/api/v1/trades/${encodeURIComponent(tradeId)}`,
  );
  return res.data;
}

export async function payTrade(tradeId: string): Promise<void> {
  await request<ApiEnvelope<{ paid: boolean }>>(
    `/api/v1/trades/${encodeURIComponent(tradeId)}/pay`,
    { method: "POST" },
  );
}

export async function confirmTrade(tradeId: string): Promise<void> {
  await request<ApiEnvelope<{ completed: boolean }>>(
    `/api/v1/trades/${encodeURIComponent(tradeId)}/confirm`,
    { method: "POST" },
  );
}

export async function cancelTrade(tradeId: string): Promise<void> {
  await request<ApiEnvelope<{ cancelled: boolean }>>(
    `/api/v1/trades/${encodeURIComponent(tradeId)}/cancel`,
    { method: "POST" },
  );
}
