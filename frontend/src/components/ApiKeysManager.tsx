import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  apiUrl,
  AUTH_TOKEN_STORAGE_KEY,
  clearStoredAuthToken,
} from "../lib/auth-api.js";
import { IntegratorSubNav } from "./IntegratorSubNav.js";
import { INTEGRATOR_PAGE_LIMIT, usePaginatedQuery } from "../hooks/usePaginatedQuery.js";

const API_KEYS_QUERY_KEY = ["api-keys"] as const;

function paginatedListPath(base: string, limit: number, cursor: string | undefined): string {
  const q = new URLSearchParams();
  q.set("limit", String(limit));
  if (cursor !== undefined && cursor.length > 0) {
    q.set("cursor", cursor);
  }
  return `${base}?${q.toString()}`;
}

type ApiKeyRow = {
  id: string;
  userId: string;
  prefix: string;
  name: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type ListResponse = {
  status: string;
  data: { items: ApiKeyRow[]; nextCursor: string | null };
};

type CreateResponse = {
  status: string;
  data: ApiKeyRow & { key: string; warning?: string };
};

function formatDatePl(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function statusLabel(row: ApiKeyRow): { text: string; className: string } {
  if (!row.isActive) {
    return { text: "Wyłączony", className: "bg-zinc-700/80 text-zinc-200" };
  }
  if (row.expiresAt !== null) {
    const ex = new Date(row.expiresAt);
    if (!Number.isNaN(ex.getTime()) && ex <= new Date()) {
      return { text: "Wygasły", className: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/35" };
    }
  }
  return { text: "Aktywny", className: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/35" };
}

export function ApiKeysManager() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [newKeyPlain, setNewKeyPlain] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [secretCopyError, setSecretCopyError] = useState("");

  const getToken = useCallback((): string | null => {
    try {
      return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  }, []);

  const logout = useCallback(() => {
    clearStoredAuthToken();
    navigate("/login", { replace: true });
  }, [navigate]);

  const keysQuery = usePaginatedQuery<ApiKeyRow>({
    queryKey: API_KEYS_QUERY_KEY,
    limit: INTEGRATOR_PAGE_LIMIT,
    fetchPage: async ({ cursor, limit }) => {
      const token = getToken();
      if (token === null || token.length === 0) {
        logout();
        throw new Error("Brak sesji.");
      }
      const res = await fetch(apiUrl(paginatedListPath("/api/v1/api-keys", limit, cursor)), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      if (res.status === 401 || res.status === 403) {
        logout();
        throw new Error("Sesja wygasła.");
      }

      const text = await res.text();
      let body: unknown = {};
      if (text.length > 0) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          throw new Error("Nieprawidłowa odpowiedź serwera (nie JSON).");
        }
      }

      if (!res.ok) {
        const err = body as { error?: string };
        throw new Error(err.error ?? `Błąd ${res.status}`);
      }

      const parsed = body as ListResponse;
      return {
        items: Array.isArray(parsed.data?.items) ? parsed.data.items : [],
        nextCursor: parsed.data?.nextCursor ?? null,
      };
    },
  });

  const items = keysQuery.data;
  const listError =
    keysQuery.isError && keysQuery.error instanceof Error ? keysQuery.error.message : "";

  const openCreateModal = (): void => {
    setCreateName("");
    setCreateError("");
    setCreateOpen(true);
  };

  const submitCreate = async (): Promise<void> => {
    const name = createName.trim();
    if (name.length === 0) {
      setCreateError("Podaj nazwę klucza.");
      return;
    }

    const token = getToken();
    if (token === null || token.length === 0) {
      logout();
      return;
    }

    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch(apiUrl("/api/v1/api-keys"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ name }),
      });

      const text = await res.text();
      let body: unknown = {};
      if (text.length > 0) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          throw new Error("Nieprawidłowa odpowiedź serwera (nie JSON).");
        }
      }

      if (res.status === 401 || res.status === 403) {
        logout();
        return;
      }

      if (!res.ok) {
        const err = body as { error?: string };
        throw new Error(err.error ?? `Błąd ${res.status}`);
      }

      const parsed = body as CreateResponse;
      const key = parsed.data?.key;
      if (typeof key !== "string" || key.length === 0) {
        throw new Error("Brak klucza w odpowiedzi serwera.");
      }

      setCreateOpen(false);
      setSecretCopyError("");
      setNewKeyPlain(key);
      await queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Nie udało się utworzyć klucza.";
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  };

  const copyKey = async (): Promise<void> => {
    if (newKeyPlain === null) return;
    setSecretCopyError("");
    try {
      await navigator.clipboard.writeText(newKeyPlain);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setSecretCopyError("Nie udało się skopiować — zaznacz tekst ręcznie.");
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0f0e] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(124,58,237,0.12),transparent)]" />

      <div className="relative mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Link
              to="/dashboard"
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700/80 bg-zinc-900/60 text-zinc-300 transition hover:border-violet-500/40 hover:bg-zinc-800/80 hover:text-white"
              aria-label="Wróć do pulpitu"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-violet-400/90">
                Panel integratora B2B
              </p>
              <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                <KeyRound className="h-7 w-7 text-violet-400" aria-hidden />
                Klucze API
              </h1>
              <p className="mt-2 max-w-xl text-sm text-zinc-400">
                Używaj kluczy w nagłówku{" "}
                <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-violet-200">
                  x-api-key
                </code>{" "}
                lub{" "}
                <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-violet-200">
                  Authorization: Bearer apx_live_…
                </code>
                .
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-900/30 transition hover:bg-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f0e]"
          >
            <Plus className="h-4 w-4" />
            Wygeneruj nowy klucz
          </button>
        </header>

        <IntegratorSubNav />

        {listError.length > 0 && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{listError}</span>
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.7)] backdrop-blur-sm">
          <div className="border-b border-zinc-800/80 px-5 py-4 sm:px-6">
            <h2 className="text-sm font-medium text-zinc-200">Twoje klucze</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Pełny sekret widoczny jest tylko raz — przy utworzeniu.
            </p>
          </div>

          <div className="overflow-x-auto">
            {keysQuery.isPending && items.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-20 text-zinc-400">
                <Loader2 className="h-6 w-6 animate-spin text-violet-400" aria-hidden />
                <span>Ładowanie listy…</span>
              </div>
            ) : items.length === 0 ? (
              <div className="px-5 py-16 text-center sm:px-6">
                <p className="text-sm text-zinc-400">Nie masz jeszcze żadnego klucza API.</p>
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="mt-4 text-sm font-medium text-violet-400 hover:text-violet-300"
                >
                  Wygeneruj pierwszy klucz
                </button>
              </div>
            ) : (
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-800/80 text-xs uppercase tracking-wide text-zinc-500">
                    <th className="px-5 py-3 font-medium sm:px-6">Nazwa</th>
                    <th className="px-5 py-3 font-medium sm:px-6">Prefix</th>
                    <th className="px-5 py-3 font-medium sm:px-6">Data utworzenia</th>
                    <th className="px-5 py-3 font-medium sm:px-6">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {items.map((row) => {
                    const st = statusLabel(row);
                    return (
                      <tr
                        key={row.id}
                        className="transition-colors hover:bg-zinc-800/30"
                      >
                        <td className="px-5 py-3.5 font-medium text-zinc-100 sm:px-6">
                          {row.name}
                        </td>
                        <td className="px-5 py-3.5 sm:px-6">
                          <code className="rounded-md bg-zinc-950/80 px-2 py-1 font-mono text-xs text-zinc-300">
                            {row.prefix}…
                          </code>
                        </td>
                        <td className="px-5 py-3.5 text-zinc-400 sm:px-6">
                          {formatDatePl(row.createdAt)}
                        </td>
                        <td className="px-5 py-3.5 sm:px-6">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${st.className}`}
                          >
                            {st.text}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {keysQuery.hasNextPage && (
            <div className="border-t border-zinc-800/80 px-5 py-4 sm:px-6">
              <button
                type="button"
                disabled={keysQuery.isFetchingNextPage}
                onClick={() => void keysQuery.fetchNextPage()}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-600 bg-zinc-900/60 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-violet-500/40 hover:bg-zinc-800/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {keysQuery.isFetchingNextPage ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-violet-400" aria-hidden />
                    Ładowanie…
                  </>
                ) : (
                  "Załaduj więcej"
                )}
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Modal: nazwa nowego klucza */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center sm:p-6"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !creating) setCreateOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-key-title"
            className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 id="create-key-title" className="text-lg font-semibold text-white">
                Nowy klucz API
              </h2>
              <button
                type="button"
                onClick={() => !creating && setCreateOpen(false)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                aria-label="Zamknij"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 text-sm text-zinc-400">
              Nadaj nazwę, np. „Sklep produkcja”, aby odróżnić klucze w panelu.
            </p>
            <label htmlFor="key-name" className="mt-4 block text-xs font-medium text-zinc-400">
              Nazwa
            </label>
            <input
              id="key-name"
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="np. Sklep produkcja"
              maxLength={128}
              disabled={creating}
              className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !creating) void submitCreate();
              }}
            />
            {createError.length > 0 && (
              <p className="mt-2 text-sm text-red-400" role="alert">
                {createError}
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={creating}
                onClick={() => setCreateOpen(false)}
                className="rounded-lg border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                Anuluj
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => void submitCreate()}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Tworzenie…
                  </>
                ) : (
                  "Utwórz klucz"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: surowy klucz (tylko raz) */}
      {newKeyPlain !== null && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 p-4 sm:items-center sm:p-6">
          <div
            role="alertdialog"
            aria-labelledby="secret-key-title"
            aria-describedby="secret-key-desc"
            className="w-full max-w-lg rounded-2xl border border-amber-500/30 bg-zinc-900 p-6 shadow-2xl ring-1 ring-amber-500/20"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
                <AlertTriangle className="h-5 w-5 text-amber-400" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="secret-key-title" className="text-lg font-semibold text-white">
                  Zapisz klucz API
                </h2>
                <p id="secret-key-desc" className="mt-2 text-sm leading-relaxed text-amber-100/90">
                  <strong className="text-amber-200">Skopiuj ten klucz teraz.</strong> Ze względów
                  bezpieczeństwa nie pokażemy go ponownie.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-zinc-700 bg-zinc-950 p-3">
              <code className="block break-all font-mono text-xs leading-relaxed text-emerald-300 sm:text-sm">
                {newKeyPlain}
              </code>
            </div>

            {secretCopyError.length > 0 && (
              <p className="mt-3 text-sm text-red-400">{secretCopyError}</p>
            )}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => void copyKey()}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-white sm:flex-none"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-600" />
                    Skopiowano
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Skopiuj do schowka
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewKeyPlain(null);
                  setCopied(false);
                  setSecretCopyError("");
                }}
                className="rounded-lg border border-zinc-600 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
              >
                Rozumiem, zamknij
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
