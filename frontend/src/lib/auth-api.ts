/** Klucz localStorage dla JWT z odpowiedzi logowania (równolegle backend może ustawić ciasteczko httpOnly). */
export const AUTH_TOKEN_STORAGE_KEY = "apexpay_token";

export type LoginResponse = {
  token: string;
  id: string;
  email: string;
  role: string;
  createdAt: string;
  updatedAt: string;
};

/** Bazowy URL API (prod). W dev zwykle pusto — żądania idą na ten sam origin co Vite, proxy przekazuje `/api`. */
export function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

export class AuthApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
  }
}

function mapServerErrorMessage(status: number, raw: string): string {
  if (status === 401) {
    return "Nieprawidłowy e-mail lub hasło.";
  }
  if (status === 400) {
    if (raw.includes("Email and password are required")) {
      return "E-mail i hasło są wymagane.";
    }
    return raw.length > 0 ? raw : "Niepoprawne dane logowania.";
  }
  if (status >= 500) {
    return "Serwer jest chwilowo niedostępny. Spróbuj za chwilę.";
  }
  return raw.length > 0 ? raw : `Błąd ${status}`;
}

/**
 * POST `/api/v1/auth/login` — zwraca body z tokenem lub rzuca `AuthApiError`.
 */
export async function loginWithPassword(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const res = await fetch(apiUrl("/api/v1/auth/login"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });

  const text = await res.text();
  let data: unknown = {};
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new AuthApiError("Nieprawidłowa odpowiedź serwera (nie JSON).", res.status);
    }
  }

  if (!res.ok) {
    const errObj = data as { error?: string; message?: string };
    const raw = String(errObj.error ?? errObj.message ?? "");
    throw new AuthApiError(mapServerErrorMessage(res.status, raw), res.status);
  }

  const body = data as Partial<LoginResponse>;
  if (typeof body.token !== "string" || body.token.length === 0) {
    throw new AuthApiError("Brak tokena w odpowiedzi serwera.", res.status);
  }

  return data as LoginResponse;
}

export function persistAuthToken(token: string): void {
  try {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearStoredAuthToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
