import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CreditCard,
  Landmark,
  ShieldAlert,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiUrl, AUTH_TOKEN_STORAGE_KEY, clearStoredAuthToken } from "../lib/auth-api.js";

type OverviewResponse = {
  status: string;
  data: {
    totalCharges: { count: number; amountPln: number };
    totalPayouts: { count: number; amountPln: number };
    totalRefunds: { count: number; amountPln: number };
    fraudBlocked: number;
    fraudFlagged: number;
    activeConnectedAccounts: number;
    pendingDisputes: number;
  };
};

type RevenuePoint = {
  date: string;
  chargesAmount: number;
  payoutsAmount: number;
  refundsAmount: number;
};

type FraudPoint = {
  date: string;
  blocked: number;
  flagged: number;
  passed: number;
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatPln(value: number): string {
  return `${value.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PLN`;
}

function parseApiError(text: string, status: number): string {
  if (text.length === 0) {
    return `Błąd ${status}`;
  }
  try {
    const json = JSON.parse(text) as { error?: string };
    return json.error ?? `Błąd ${status}`;
  } catch {
    return `Błąd ${status}`;
  }
}

function useAuthJson(navigate: ReturnType<typeof useNavigate>) {
  return async <T,>(path: string): Promise<T> => {
    const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (token === null || token.length === 0) {
      clearStoredAuthToken();
      navigate("/login", { replace: true });
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
      clearStoredAuthToken();
      navigate("/login", { replace: true });
      throw new Error("Sesja wygasła.");
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(parseApiError(text, res.status));
    }
    if (text.length === 0) {
      throw new Error("Pusta odpowiedź serwera.");
    }
    return JSON.parse(text) as T;
  };
}

function KpiCard(props: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-3 text-violet-300">{props.icon}</div>
      <div className="text-2xl font-semibold text-white">{props.value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-zinc-400">{props.label}</div>
    </div>
  );
}

export function AdminAnalyticsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const today = new Date();
  const defaultTo = isoDate(today);
  const defaultFrom = isoDate(new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000));
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [granularity, setGranularity] = useState<"day" | "week" | "month">("day");
  const fetchJson = useAuthJson(navigate);

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["admin-analytics"] });
  }, [from, to, granularity, queryClient]);

  const rangeQuery = useMemo(() => {
    const query = new URLSearchParams({ from, to });
    return query.toString();
  }, [from, to]);

  const fraudFrom = useMemo(() => {
    const toDate = new Date(`${to}T00:00:00.000Z`);
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const minFraudFrom = new Date(toDate);
    minFraudFrom.setUTCDate(minFraudFrom.getUTCDate() - 13);
    return isoDate(minFraudFrom > fromDate ? minFraudFrom : fromDate);
  }, [from, to]);

  const overviewQuery = useQuery({
    queryKey: ["admin-analytics", "overview", from, to],
    queryFn: () => fetchJson<OverviewResponse>(`/api/v1/admin/analytics/overview?${rangeQuery}`),
  });

  const revenueQuery = useQuery({
    queryKey: ["admin-analytics", "revenue", from, to, granularity],
    queryFn: () =>
      fetchJson<{ status: string; data: RevenuePoint[] }>(
        `/api/v1/admin/analytics/revenue-chart?${rangeQuery}&granularity=${granularity}`,
      ),
  });

  const fraudQuery = useQuery({
    queryKey: ["admin-analytics", "fraud", fraudFrom, to],
    queryFn: () =>
      fetchJson<{ status: string; data: FraudPoint[] }>(
        `/api/v1/admin/analytics/fraud-chart?from=${encodeURIComponent(fraudFrom)}&to=${encodeURIComponent(to)}`,
      ),
  });

  const isLoading = overviewQuery.isPending || revenueQuery.isPending || fraudQuery.isPending;
  const error =
    (overviewQuery.error instanceof Error && overviewQuery.error.message) ||
    (revenueQuery.error instanceof Error && revenueQuery.error.message) ||
    (fraudQuery.error instanceof Error && fraudQuery.error.message) ||
    "";
  const overview = overviewQuery.data?.data;

  return (
    <div className="min-h-screen bg-[#0b0f0e] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(124,58,237,0.12),transparent)]" />
      <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Link
              to="/dashboard"
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700/80 bg-zinc-900/60 text-zinc-300 transition hover:border-violet-500/40 hover:bg-zinc-800/80 hover:text-white"
              aria-label="Wróć do pulpitu"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-violet-400/90">Panel admina</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Analytics Dashboard
              </h1>
            </div>
          </div>
        </header>

        <section className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="from-date" className="mb-1 block text-xs text-zinc-400">
                Od
              </label>
              <input
                id="from-date"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label htmlFor="to-date" className="mb-1 block text-xs text-zinc-400">
                Do
              </label>
              <input
                id="to-date"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label htmlFor="granularity" className="mb-1 block text-xs text-zinc-400">
                Granulacja
              </label>
              <select
                id="granularity"
                value={granularity}
                onChange={(e) =>
                  setGranularity(e.target.value === "week" || e.target.value === "month" ? e.target.value : "day")
                }
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
              >
                <option value="day">Dzień</option>
                <option value="week">Tydzień</option>
                <option value="month">Miesiąc</option>
              </select>
            </div>
          </div>
        </section>

        {error.length > 0 && (
          <div className="mb-6 flex items-start gap-2 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {isLoading || overview === undefined ? (
            Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="h-28 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
            ))
          ) : (
            <>
              <KpiCard icon={<Wallet className="h-5 w-5" />} label="Przychód (charges)" value={formatPln(overview.totalCharges.amountPln)} />
              <KpiCard icon={<Landmark className="h-5 w-5" />} label="Wypłaty" value={formatPln(overview.totalPayouts.amountPln)} />
              <KpiCard icon={<CreditCard className="h-5 w-5" />} label="Zwroty" value={formatPln(overview.totalRefunds.amountPln)} />
              <KpiCard icon={<Ban className="h-5 w-5" />} label="Fraud zablokowany" value={String(overview.fraudBlocked)} />
              <KpiCard icon={<Users className="h-5 w-5" />} label="Aktywne subkonta" value={String(overview.activeConnectedAccounts)} />
              <KpiCard icon={<ShieldAlert className="h-5 w-5" />} label="Spory w toku" value={String(overview.pendingDisputes)} />
            </>
          )}
        </section>

        <section className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/45 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-200">Przepływy finansowe</h2>
          <div className="h-[340px]">
            {revenueQuery.isPending ? (
              <div className="h-full animate-pulse rounded-xl bg-zinc-800/40" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueQuery.data?.data ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                  <XAxis dataKey="date" stroke="#a1a1aa" />
                  <YAxis stroke="#a1a1aa" />
                  <Tooltip
                    formatter={(value) => {
                      const numeric =
                        typeof value === "number" ? value : Number.parseFloat(String(value ?? 0));
                      return [formatPln(Number.isFinite(numeric) ? numeric : 0), ""];
                    }}
                    contentStyle={{ backgroundColor: "#18181b", borderColor: "#3f3f46" }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="chargesAmount" stroke="#3b82f6" name="Wpłaty" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="payoutsAmount" stroke="#22c55e" name="Wypłaty" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="refundsAmount" stroke="#ef4444" name="Zwroty" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/45 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-200">Fraud detection (ostatnie 14 dni w zakresie)</h2>
          <div className="h-[320px]">
            {fraudQuery.isPending ? (
              <div className="h-full animate-pulse rounded-xl bg-zinc-800/40" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fraudQuery.data?.data ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                  <XAxis dataKey="date" stroke="#a1a1aa" />
                  <YAxis stroke="#a1a1aa" />
                  <Tooltip contentStyle={{ backgroundColor: "#18181b", borderColor: "#3f3f46" }} />
                  <Legend />
                  <Bar dataKey="blocked" fill="#ef4444" name="Zablokowane" />
                  <Bar dataKey="flagged" fill="#f59e0b" name="Oflagowane" />
                  <Bar dataKey="passed" fill="#22c55e" name="Przepuszczone" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
