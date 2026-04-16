import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Loader2,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  apiUrl,
  AUTH_TOKEN_STORAGE_KEY,
  clearStoredAuthToken,
} from "../lib/auth-api.js";
import { IntegratorSubNav } from "./IntegratorSubNav.js";
import { INTEGRATOR_PAGE_LIMIT, usePaginatedQuery } from "../hooks/usePaginatedQuery.js";
import { ExportCsvButton } from "./ExportCsvButton.js";

const CHARGES_KEY = ["integrations", "charges"] as const;
const PAYOUTS_KEY = ["integrations", "payouts"] as const;

function paginatedListPath(base: string, limit: number, cursor: string | undefined): string {
  const q = new URLSearchParams();
  q.set("limit", String(limit));
  if (cursor !== undefined && cursor.length > 0) {
    q.set("cursor", cursor);
  }
  return `${base}?${q.toString()}`;
}

type ChargeRow = {
  id: string;
  amountCents: string;
  currency: string;
  createdAt: string;
  connectedAccountIds: string[];
};

type PayoutRow = {
  id: string;
  amount: string;
  currency: string;
  status: "PENDING" | "IN_TRANSIT" | "PAID" | "FAILED";
  createdAt: string;
  connectedAccountId: string;
  connectedAccountEmail: string;
};

/** Kwota w jednostkach drobnych (grosze) → zapis dziesiętny z przecinkiem (bez waluty). */
function formatMinorUnits(raw: string): string {
  try {
    const n = BigInt(raw.trim());
    const neg = n < 0n;
    const v = neg ? -n : n;
    const zl = v / 100n;
    const gr = Number(v % 100n);
    const frac = gr.toString().padStart(2, "0");
    const s = `${zl.toLocaleString("pl-PL")},${frac}`;
    return neg ? `-${s}` : s;
  } catch {
    return raw;
  }
}

function formatDatePl(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function payoutStatusBadge(status: PayoutRow["status"]): string {
  switch (status) {
    case "PAID":
      return "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40";
    case "PENDING":
    case "IN_TRANSIT":
      return "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/35";
    case "FAILED":
      return "bg-red-500/15 text-red-300 ring-1 ring-red-500/40";
    default:
      return "bg-zinc-700/80 text-zinc-200";
  }
}

export function PaymentsManager() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"charges" | "payouts">("charges");

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

  const fetchJson = useCallback(
    async <T,>(path: string): Promise<T> => {
      const token = getToken();
      if (token === null || token.length === 0) {
        logout();
        throw new Error("Brak sesji.");
      }
      const res = await fetch(apiUrl(path), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        credentials: "include",
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
          throw new Error("Nieprawidłowa odpowiedź serwera.");
        }
      }
      if (!res.ok) {
        const err = body as { error?: string };
        throw new Error(err.error ?? `Błąd ${res.status}`);
      }
      return body as T;
    },
    [getToken, logout],
  );

  const chargesQuery = usePaginatedQuery<ChargeRow>({
    queryKey: CHARGES_KEY,
    limit: INTEGRATOR_PAGE_LIMIT,
    fetchPage: async ({ cursor, limit }) => {
      const data = await fetchJson<{
        status: string;
        data: { items: ChargeRow[]; nextCursor: string | null };
      }>(paginatedListPath("/api/v1/integrations/charges", limit, cursor));
      return {
        items: Array.isArray(data.data?.items) ? data.data.items : [],
        nextCursor: data.data?.nextCursor ?? null,
      };
    },
  });

  const payoutsQuery = usePaginatedQuery<PayoutRow>({
    queryKey: PAYOUTS_KEY,
    limit: INTEGRATOR_PAGE_LIMIT,
    fetchPage: async ({ cursor, limit }) => {
      const data = await fetchJson<{
        status: string;
        data: { items: PayoutRow[]; nextCursor: string | null };
      }>(paginatedListPath("/api/v1/integrations/payouts", limit, cursor));
      return {
        items: Array.isArray(data.data?.items) ? data.data.items : [],
        nextCursor: data.data?.nextCursor ?? null,
      };
    },
  });

  const chargesErr =
    chargesQuery.isError && chargesQuery.error instanceof Error
      ? chargesQuery.error.message
      : "";
  const payoutsErr =
    payoutsQuery.isError && payoutsQuery.error instanceof Error
      ? payoutsQuery.error.message
      : "";

  return (
    <div className="min-h-screen bg-[#0b0f0e] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(124,58,237,0.12),transparent)]" />

      <div className="relative mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4">
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
                <Banknote className="h-7 w-7 text-violet-400" aria-hidden />
                Płatności i wypłaty
              </h1>
              <p className="mt-2 max-w-xl text-sm text-zinc-400">
                Podgląd charge’ów marketplace oraz wypłat z subkont (kwoty w jednostkach drobnych — grosze).
              </p>
            </div>
          </div>
        </header>

        <IntegratorSubNav />

        <div className="mb-6 flex flex-wrap gap-2 border-b border-zinc-800 pb-1">
          <button
            type="button"
            onClick={() => setTab("charges")}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${
              tab === "charges"
                ? "border border-b-0 border-zinc-700 bg-zinc-900/60 text-violet-200"
                : "border border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Wpłaty (Charges)
          </button>
          <button
            type="button"
            onClick={() => setTab("payouts")}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${
              tab === "payouts"
                ? "border border-b-0 border-zinc-700 bg-zinc-900/60 text-violet-200"
                : "border border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Wypłaty (Payouts)
          </button>
        </div>

        {tab === "charges" && (
          <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.7)] backdrop-blur-sm">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-800/80 px-5 py-4 sm:px-6">
              <h2 className="text-sm font-medium text-zinc-200">Wpłaty (Charges)</h2>
              <ExportCsvButton
                endpoint="/api/v1/integrations/charges/export"
                filename="charges.csv"
                label="Eksportuj CSV"
              />
            </div>
            {chargesErr.length > 0 && (
              <div
                role="alert"
                className="mx-5 mt-4 flex items-start gap-3 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-200 sm:mx-6"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{chargesErr}</span>
              </div>
            )}
            <div className="overflow-x-auto">
              {chargesQuery.isPending && chargesQuery.data.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-20 text-zinc-400">
                  <Loader2 className="h-6 w-6 animate-spin text-violet-400" aria-hidden />
                  <span>Ładowanie…</span>
                </div>
              ) : chargesQuery.data.length === 0 ? (
                <p className="px-5 py-16 text-center text-sm text-zinc-500 sm:px-6">
                  Brak charge’ów.
                </p>
              ) : (
                <table className="w-full min-w-[800px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800/80 text-xs uppercase tracking-wide text-zinc-500">
                      <th className="px-5 py-3 font-medium sm:px-6">ID</th>
                      <th className="px-5 py-3 font-medium sm:px-6">Kwota</th>
                      <th className="px-5 py-3 font-medium sm:px-6">Waluta</th>
                      <th className="px-5 py-3 font-medium sm:px-6">Subkonto (ID)</th>
                      <th className="px-5 py-3 font-medium sm:px-6">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {chargesQuery.data.map((row) => (
                      <tr key={row.id} className="transition-colors hover:bg-zinc-800/30">
                        <td className="px-5 py-3.5 font-mono text-xs text-zinc-300 sm:px-6">
                          {row.id}
                        </td>
                        <td className="px-5 py-3.5 text-zinc-100 sm:px-6">
                          {formatMinorUnits(row.amountCents)}
                        </td>
                        <td className="px-5 py-3.5 text-zinc-400 sm:px-6">{row.currency}</td>
                        <td className="max-w-xs px-5 py-3.5 font-mono text-xs text-zinc-400 sm:px-6">
                          {row.connectedAccountIds.length === 0
                            ? "—"
                            : row.connectedAccountIds.join(", ")}
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
            {chargesQuery.hasNextPage && (
              <div className="border-t border-zinc-800/80 px-5 py-4 sm:px-6">
                <button
                  type="button"
                  disabled={chargesQuery.isFetchingNextPage}
                  onClick={() => void chargesQuery.fetchNextPage()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-600 bg-zinc-900/60 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-violet-500/40 hover:bg-zinc-800/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {chargesQuery.isFetchingNextPage ? (
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
        )}

        {tab === "payouts" && (
          <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.7)] backdrop-blur-sm">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-800/80 px-5 py-4 sm:px-6">
              <h2 className="text-sm font-medium text-zinc-200">Wypłaty (Payouts)</h2>
              <ExportCsvButton
                endpoint="/api/v1/integrations/payouts/export"
                filename="payouts.csv"
                label="Eksportuj CSV"
              />
            </div>
            {payoutsErr.length > 0 && (
              <div
                role="alert"
                className="mx-5 mt-4 flex items-start gap-3 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-200 sm:mx-6"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{payoutsErr}</span>
              </div>
            )}
            <div className="overflow-x-auto">
              {payoutsQuery.isPending && payoutsQuery.data.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-20 text-zinc-400">
                  <Loader2 className="h-6 w-6 animate-spin text-violet-400" aria-hidden />
                  <span>Ładowanie…</span>
                </div>
              ) : payoutsQuery.data.length === 0 ? (
                <p className="px-5 py-16 text-center text-sm text-zinc-500 sm:px-6">
                  Brak wypłat.
                </p>
              ) : (
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800/80 text-xs uppercase tracking-wide text-zinc-500">
                      <th className="px-5 py-3 font-medium sm:px-6">ID</th>
                      <th className="px-5 py-3 font-medium sm:px-6">Kwota</th>
                      <th className="px-5 py-3 font-medium sm:px-6">Subkonto</th>
                      <th className="px-5 py-3 font-medium sm:px-6">Status</th>
                      <th className="px-5 py-3 font-medium sm:px-6">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {payoutsQuery.data.map((row) => (
                      <tr key={row.id} className="transition-colors hover:bg-zinc-800/30">
                        <td className="px-5 py-3.5 font-mono text-xs text-zinc-300 sm:px-6">
                          {row.id}
                        </td>
                        <td className="px-5 py-3.5 text-zinc-100 sm:px-6">
                          {formatMinorUnits(row.amount)}
                        </td>
                        <td className="px-5 py-3.5 sm:px-6">
                          <div className="font-mono text-xs text-zinc-300">{row.connectedAccountId}</div>
                          <div className="text-xs text-zinc-500">{row.connectedAccountEmail}</div>
                        </td>
                        <td className="px-5 py-3.5 sm:px-6">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${payoutStatusBadge(row.status)}`}
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
            {payoutsQuery.hasNextPage && (
              <div className="border-t border-zinc-800/80 px-5 py-4 sm:px-6">
                <button
                  type="button"
                  disabled={payoutsQuery.isFetchingNextPage}
                  onClick={() => void payoutsQuery.fetchNextPage()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-600 bg-zinc-900/60 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-violet-500/40 hover:bg-zinc-800/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {payoutsQuery.isFetchingNextPage ? (
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
        )}
      </div>
    </div>
  );
}
