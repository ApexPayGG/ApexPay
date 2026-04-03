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
  if (status === 405) {
    return "Serwer odrzucił metodę (405). Zwykle POST /api/… trafia w front zamiast w API — sprawdź Traefik (router api-inapp → service=api) i wdrożenie docker-compose.prod.yml.";
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
  const contentType = res.headers.get("content-type") ?? "";
  let data: unknown = {};
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      const looksLikeHtml =
        text.trimStart().startsWith("<") ||
        /<\s*!doctype\s+html/i.test(text) ||
        contentType.includes("text/html");
      const hint = looksLikeHtml
        ? res.status === 405
          ? " HTTP 405 + HTML — często Traefik kieruje POST /api/… na kontener web zamiast api: dodaj etykietę traefik.http.routers.api-inapp.service=api i ponów compose up (patrz docker-compose.prod.yml)."
          : " Serwer zwrócił stronę HTML zamiast JSON — zwykle brak proxy `/api/` do backendu (patrz deploy/nginx/web.conf) albo zły adres API przy buildzie frontu. Opcje: (1) zostaw `VITE_API_URL` puste i zapewnij reverse proxy `https://twoja-domena/api/` → Node; (2) ustaw przy buildzie `VITE_API_URL=https://twoje-api` (np. zmienna repozytorium GitHub `VITE_API_URL`) i `CORS_ORIGIN` na API."
        : ` (HTTP ${res.status}, Content-Type: ${contentType || "brak"})`;
      throw new AuthApiError(
        `Nieprawidłowa odpowiedź serwera (nie JSON).${hint}`,
        res.status,
      );
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

export type RegisterResponse = {
  message: string;
  userId: string;
};

function mapRegisterError(status: number, raw: string): string {
  if (status === 409) {
    return "Ten adres e-mail jest już zarejestrowany.";
  }
  if (status === 405) {
    return "Serwer odrzucił metodę (405) — routing /api/… do API (Traefik service=api dla api-inapp).";
  }
  if (status === 400) {
    if (raw.length > 0) return raw;
    return "Niepoprawne dane rejestracji.";
  }
  if (status === 403) {
    return "Ta operacja jest niedozwolona.";
  }
  if (status >= 500) {
    return "Serwer jest chwilowo niedostępny. Spróbuj za chwilę.";
  }
  return raw.length > 0 ? raw : `Błąd ${status}`;
}

/**
 * POST `/api/v1/auth/register` — tworzy konto (bez JWT; po sukcesie zwykle przekieruj na /login).
 */
export async function registerWithPassword(
  email: string,
  password: string,
): Promise<RegisterResponse> {
  const res = await fetch(apiUrl("/api/v1/auth/register"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });

  const text = await res.text();
  const contentTypeRegister = res.headers.get("content-type") ?? "";
  let data: unknown = {};
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      const looksLikeHtml =
        text.trimStart().startsWith("<") ||
        /<\s*!doctype\s+html/i.test(text) ||
        contentTypeRegister.includes("text/html");
      const hint = looksLikeHtml
        ? res.status === 405
          ? " HTTP 405 + HTML — patrz Traefik api-inapp.service=api i docker-compose.prod.yml."
          : " Serwer zwrócił HTML zamiast JSON — sprawdź proxy `/api/` do backendu lub `VITE_API_URL` przy buildzie obrazu web."
        : ` (HTTP ${res.status}, Content-Type: ${contentTypeRegister || "brak"})`;
      throw new AuthApiError(
        `Nieprawidłowa odpowiedź serwera (nie JSON).${hint}`,
        res.status,
      );
    }
  }

  if (!res.ok) {
    const errObj = data as { error?: string; message?: string };
    const raw = String(errObj.error ?? errObj.message ?? "");
    throw new AuthApiError(mapRegisterError(res.status, raw), res.status);
  }

  const body = data as Partial<RegisterResponse>;
  if (typeof body.userId !== "string" || body.userId.length === 0) {
    throw new AuthApiError("Brak identyfikatora użytkownika w odpowiedzi.", res.status);
  }
  return {
    message: typeof body.message === "string" ? body.message : "Konto utworzone.",
    userId: body.userId,
  };
}
