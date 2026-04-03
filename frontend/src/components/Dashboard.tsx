import { Activity, LogOut, RefreshCcw, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl, clearStoredAuthToken } from "../lib/auth-api.js";
import "./Dashboard.css";

type WalletResponse = {
  walletId: string;
  balance: string;
  updatedAt: string;
};

type MeResponse = {
  id: string;
  email: string;
  role: string;
};

type AdminTransactionRow = {
  id: string;
  amount: string;
  referenceId: string;
  type: string;
  createdAt: string;
  walletUserId: string;
};

type AdminTransactionsResponse = {
  items: AdminTransactionRow[];
};

/** Salda i kwoty transakcji w API są w groszach (minor units). */
function formatGroszeAsPln(raw: string): string {
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

function parseBalance(raw: string): string {
  return formatGroszeAsPln(raw);
}

function formatAmount(raw: string): { text: string; cls: string } {
  try {
    const n = BigInt(raw.trim());
    const absPln = formatGroszeAsPln((n < 0n ? -n : n).toString());
    if (n > 0n) return { text: `+${absPln}`, cls: "is-positive" };
    if (n < 0n) return { text: `-${absPln}`, cls: "is-negative" };
    return { text: "0,00", cls: "" };
  } catch {
    const n = Number(raw);
    if (!Number.isFinite(n)) return { text: raw, cls: "" };
    if (n > 0) return { text: `+${n.toLocaleString("pl-PL")}`, cls: "is-positive" };
    if (n < 0) return { text: n.toLocaleString("pl-PL"), cls: "is-negative" };
    return { text: "0", cls: "" };
  }
}

function formatDatePl(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function Dashboard() {
  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [transactions, setTransactions] = useState<AdminTransactionRow[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleLogout = useCallback((): void => {
    clearStoredAuthToken();
    navigate("/login", { replace: true });
  }, [navigate]);

  const loadDashboard = useCallback(
    async (isRefresh: boolean): Promise<void> => {
      const token = localStorage.getItem("apexpay_token");
      if (token === null || token.length === 0) {
        handleLogout();
        return;
      }

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const [meRes, walletRes] = await Promise.all([
          fetch(apiUrl("/api/v1/auth/me"), {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(apiUrl("/api/v1/wallet/me"), {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        if (
          meRes.status === 401 ||
          meRes.status === 403 ||
          walletRes.status === 401 ||
          walletRes.status === 403
        ) {
          handleLogout();
          return;
        }

        if (!meRes.ok) {
          throw new Error("Nie udało się pobrać profilu.");
        }
        if (!walletRes.ok) {
          throw new Error("Nie udało się pobrać salda.");
        }

        const me = (await meRes.json()) as MeResponse;
        const walletData = (await walletRes.json()) as WalletResponse;

        setRole(me.role);
        setWallet(walletData);

        if (me.role === "ADMIN") {
          const txRes = await fetch(apiUrl("/api/v1/admin/transactions?limit=8&page=0"), {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (txRes.status === 401 || txRes.status === 403) {
            handleLogout();
            return;
          }

          if (!txRes.ok) {
            throw new Error("Nie udało się pobrać historii transakcji.");
          }

          const txData = (await txRes.json()) as AdminTransactionsResponse;
          setTransactions(Array.isArray(txData.items) ? txData.items : []);
        } else {
          setTransactions([]);
        }

        setError("");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Nieznany błąd połączenia.";
        setError(msg);
      } finally {
        if (isRefresh) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [handleLogout],
  );

  useEffect(() => {
    void loadDashboard(false);
    const id = setInterval(() => {
      void loadDashboard(true);
    }, 10_000);
    return () => {
      clearInterval(id);
    };
  }, [loadDashboard]);

  const balanceText = useMemo(() => {
    if (wallet === null) return "—";
    return parseBalance(wallet.balance);
  }, [wallet]);

  const showTransactions = role === "ADMIN";

  return (
    <div className="dashboard-page">
      <div className="dashboard-page__container">
        <header className="dashboard-header">
          <div className="dashboard-header__brand">
            <Activity className="dashboard-header__brand-icon" />
            <h1>ApexPay</h1>
          </div>
          <div className="dashboard-header__actions">
            {refreshing && <span className="dashboard-header__refreshing">Odświeżanie…</span>}
            <button
              onClick={() => void loadDashboard(true)}
              className="dashboard-header__refresh"
              disabled={loading || refreshing}
              title="Odśwież saldo i historię"
            >
              <RefreshCcw size={16} />
              <span>Odśwież teraz</span>
            </button>
            <button onClick={handleLogout} className="dashboard-header__logout">
              <LogOut size={16} />
              <span>Wyloguj</span>
            </button>
          </div>
        </header>

        <main>
          {error.length > 0 && <div className="dashboard-error">{error}</div>}

          <section className="dashboard-balance-card">
            <div className="dashboard-balance-card__glow" aria-hidden />
            <div className="dashboard-balance-card__content">
              <div>
                <p className="dashboard-balance-card__label">Dostępne środki</p>
                <div className="dashboard-balance-card__value-row">
                  {loading ? (
                    <span className="dashboard-skeleton dashboard-skeleton--balance" />
                  ) : (
                    <>
                      <span className="dashboard-balance-card__value">{balanceText}</span>
                      {wallet !== null && <span className="dashboard-balance-card__currency">PLN</span>}
                    </>
                  )}
                </div>
                {wallet !== null && (
                  <p className="dashboard-balance-card__meta">
                    Portfel: {wallet.walletId}
                  </p>
                )}
              </div>
              <div className="dashboard-balance-card__icon-wrap">
                <Wallet size={34} />
              </div>
            </div>
          </section>

          {showTransactions && (
            <section className="dashboard-transactions">
              <h2>Ostatnie transakcje (ADMIN)</h2>
              {loading ? (
                <div className="dashboard-transactions__skeletons">
                  <div className="dashboard-skeleton dashboard-skeleton--row" />
                  <div className="dashboard-skeleton dashboard-skeleton--row" />
                  <div className="dashboard-skeleton dashboard-skeleton--row" />
                </div>
              ) : transactions.length === 0 ? (
                <p className="dashboard-transactions__empty">Brak transakcji do wyświetlenia.</p>
              ) : (
                <div className="dashboard-transactions__table-wrap">
                  <table className="dashboard-transactions__table">
                    <thead>
                      <tr>
                        <th>Typ</th>
                        <th>Kwota</th>
                        <th>Data</th>
                        <th>Ref</th>
                        <th>Użytkownik</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((tx) => (
                        <tr key={tx.id}>
                          <td>{tx.type}</td>
                          <td className={`dashboard-transactions__amount ${formatAmount(tx.amount).cls}`}>
                            {formatAmount(tx.amount).text}
                          </td>
                          <td>{formatDatePl(tx.createdAt)}</td>
                          <td className="dashboard-transactions__mono">{tx.referenceId}</td>
                          <td className="dashboard-transactions__mono">{tx.walletUserId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

