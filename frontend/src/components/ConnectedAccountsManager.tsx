import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  apiUrl,
  AUTH_TOKEN_STORAGE_KEY,
  clearStoredAuthToken,
} from "../lib/auth-api.js";
import { IntegratorSubNav } from "./IntegratorSubNav.js";
import { INTEGRATOR_PAGE_LIMIT, usePaginatedQuery } from "../hooks/usePaginatedQuery.js";

const ACCOUNTS_QUERY_KEY = ["integrations", "accounts"] as const;

function paginatedListPath(base: string, limit: number, cursor: string | undefined): string {
  const q = new URLSearchParams();
  q.set("limit", String(limit));
  if (cursor !== undefined && cursor.length > 0) {
    q.set("cursor", cursor);
  }
  return `${base}?${q.toString()}`;
}

type AccountRow = {
  id: string;
  email: string;
  type: "INDIVIDUAL" | "COMPANY";
  country: string;
  status: "PENDING" | "ACTIVE" | "RESTRICTED" | "REJECTED";
  createdAt: string;
};

type ListResponse = {
  status: string;
  data: { items: AccountRow[]; nextCursor: string | null };
};

function formatDatePl(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function statusBadgeClasses(status: AccountRow["status"]): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40";
    case "PENDING":
      return "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/35";
    case "RESTRICTED":
      return "bg-red-500/15 text-red-300 ring-1 ring-red-500/40";
    case "REJECTED":
      return "bg-zinc-600/40 text-zinc-300 ring-1 ring-zinc-500/35";
    default:
      return "bg-zinc-700/80 text-zinc-200";
  }
}

export function ConnectedAccountsManager() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [formEmail, setFormEmail] = useState("");
  const [formType, setFormType] = useState<"INDIVIDUAL" | "COMPANY">("INDIVIDUAL");
  const [formCountry, setFormCountry] = useState("PL");
  const [createError, setCreateError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

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

  const accountsQuery = usePaginatedQuery<AccountRow>({
    queryKey: ACCOUNTS_QUERY_KEY,
    limit: INTEGRATOR_PAGE_LIMIT,
    fetchPage: async ({ cursor, limit }) => {
      const token = getToken();
      if (token === null || token.length === 0) {
        logout();
        throw new Error("Brak sesji.");
      }
      const res = await fetch(
        apiUrl(paginatedListPath("/api/v1/integrations/accounts", limit, cursor)),
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          credentials: "include",
        },
      );
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
          throw new Error("Nieprawidłowa odpowiedź serwera.");
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

  const createMutation = useMutation({
    mutationFn: async (payload: {
      email: string;
      type: "INDIVIDUAL" | "COMPANY";
      country: string;
    }) => {
      const token = getToken();
      if (token === null || token.length === 0) {
        logout();
        throw new Error("Brak sesji.");
      }
      const res = await fetch(apiUrl("/api/v1/integrations/accounts"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let body: unknown = {};
      if (text.length > 0) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          throw new Error("Nieprawidłowa odpowiedź serwera.");
        }
      }
      if (res.status === 401 || res.status === 403) {
        logout();
        throw new Error("Sesja wygasła.");
      }
      if (!res.ok) {
        const err = body as { error?: string; code?: string };
        throw new Error(err.error ?? `Błąd ${res.status}`);
      }
      return body;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
      setModalOpen(false);
      setFormEmail("");
      setFormType("INDIVIDUAL");
      setFormCountry("PL");
      setCreateError("");
      setSuccessMsg("Subkonto zostało utworzone.");
      window.setTimeout(() => setSuccessMsg(""), 5000);
    },
    onError: (e: Error) => {
      setCreateError(e.message);
    },
  });

  const submitCreate = (): void => {
    setCreateError("");
    const email = formEmail.trim();
    if (email.length === 0) {
      setCreateError("Podaj adres e-mail.");
      return;
    }
    const country = formCountry.trim().toUpperCase();
    if (country.length !== 2) {
      setCreateError("Kraj musi mieć dokładnie 2 znaki (np. PL).");
      return;
    }
    createMutation.mutate({
      email,
      type: formType,
      country,
    });
  };

  const items = accountsQuery.data;
  const loadError =
    accountsQuery.isError && accountsQuery.error instanceof Error
      ? accountsQuery.error.message
      : "";

  return (
    <div className="min-h-screen bg-[#0b0f0e] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(124,58,237,0.12),transparent)]" />

      <div className="relative mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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
                <Building2 className="h-7 w-7 text-violet-400" aria-hidden />
                Subkonta (Connected Accounts)
              </h1>
              <p className="mt-2 max-w-xl text-sm text-zinc-400">
                Subkonta KYC powiązane z Twoim kontem integratora — używane m.in. przy splitach i wypłatach.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setCreateError("");
              setModalOpen(true);
            }}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-900/30 transition hover:bg-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f0e]"
          >
            <Plus className="h-4 w-4" />
            Utwórz subkonto
          </button>
        </header>

        <IntegratorSubNav />

        {successMsg.length > 0 && (
          <div
            role="status"
            className="mb-6 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
          >
            {successMsg}
          </div>
        )}

        {loadError.length > 0 && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.7)] backdrop-blur-sm">
          <div className="border-b border-zinc-800/80 px-5 py-4 sm:px-6">
            <h2 className="text-sm font-medium text-zinc-200">Lista subkont</h2>
          </div>

          <div className="overflow-x-auto">
            {accountsQuery.isPending && items.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-20 text-zinc-400">
                <Loader2 className="h-6 w-6 animate-spin text-violet-400" aria-hidden />
                <span>Ładowanie…</span>
              </div>
            ) : items.length === 0 ? (
              <p className="px-5 py-16 text-center text-sm text-zinc-500 sm:px-6">
                Brak subkont. Użyj przycisku „Utwórz subkonto”, aby dodać pierwsze.
              </p>
            ) : (
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-800/80 text-xs uppercase tracking-wide text-zinc-500">
                    <th className="px-5 py-3 font-medium sm:px-6">E-mail</th>
                    <th className="px-5 py-3 font-medium sm:px-6">Typ</th>
                    <th className="px-5 py-3 font-medium sm:px-6">Kraj</th>
                    <th className="px-5 py-3 font-medium sm:px-6">Status</th>
                    <th className="px-5 py-3 font-medium sm:px-6">Utworzono</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {items.map((row) => (
                    <tr key={row.id} className="transition-colors hover:bg-zinc-800/30">
                      <td className="px-5 py-3.5 font-medium text-zinc-100 sm:px-6">{row.email}</td>
                      <td className="px-5 py-3.5 text-zinc-400 sm:px-6">{row.type}</td>
                      <td className="px-5 py-3.5 text-zinc-400 sm:px-6">{row.country}</td>
                      <td className="px-5 py-3.5 sm:px-6">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClasses(row.status)}`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-zinc-400 sm:px-6">
                        {formatDatePl(row.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {accountsQuery.hasNextPage && (
            <div className="border-t border-zinc-800/80 px-5 py-4 sm:px-6">
              <button
                type="button"
                disabled={accountsQuery.isFetchingNextPage}
                onClick={() => void accountsQuery.fetchNextPage()}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-600 bg-zinc-900/60 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-violet-500/40 hover:bg-zinc-800/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {accountsQuery.isFetchingNextPage ? (
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

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center sm:p-6"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !createMutation.isPending) setModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-account-title"
            className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 id="create-account-title" className="text-lg font-semibold text-white">
                Nowe subkonto (testowe)
              </h2>
              <button
                type="button"
                onClick={() => !createMutation.isPending && setModalOpen(false)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                aria-label="Zamknij"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 text-sm text-zinc-400">
              Tworzy rekord <code className="rounded bg-zinc-800 px-1 font-mono text-xs">ConnectedAccount</code> ze
              statusem PENDING (onboarding KYC).
            </p>

            <label htmlFor="acc-email" className="mt-4 block text-xs font-medium text-zinc-400">
              E-mail
            </label>
            <input
              id="acc-email"
              type="email"
              autoComplete="email"
              value={formEmail}
              onChange={(e) => setFormEmail(e.target.value)}
              disabled={createMutation.isPending}
              className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50"
              placeholder="beneficjent@example.com"
            />

            <label htmlFor="acc-type" className="mt-4 block text-xs font-medium text-zinc-400">
              Typ
            </label>
            <select
              id="acc-type"
              value={formType}
              onChange={(e) =>
                setFormType(e.target.value === "COMPANY" ? "COMPANY" : "INDIVIDUAL")
              }
              disabled={createMutation.isPending}
              className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50"
            >
              <option value="INDIVIDUAL">INDIVIDUAL</option>
              <option value="COMPANY">COMPANY</option>
            </select>

            <label htmlFor="acc-country" className="mt-4 block text-xs font-medium text-zinc-400">
              Kraj (ISO 3166-1 alpha-2)
            </label>
            <input
              id="acc-country"
              type="text"
              maxLength={2}
              value={formCountry}
              onChange={(e) => setFormCountry(e.target.value.toUpperCase())}
              disabled={createMutation.isPending}
              className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 font-mono text-sm uppercase text-white placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50"
              placeholder="PL"
            />

            {createError.length > 0 && (
              <p className="mt-3 text-sm text-red-400" role="alert">
                {createError}
              </p>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={createMutation.isPending}
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                Anuluj
              </button>
              <button
                type="button"
                disabled={createMutation.isPending}
                onClick={submitCreate}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Tworzenie…
                  </>
                ) : (
                  "Utwórz"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
