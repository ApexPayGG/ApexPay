import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, clearToken, getMe, getWallet, initiateDeposit } from "../lib/api";

const styles = {
  page: {
    minHeight: "100vh",
    background: "#1a1a1a",
    color: "rgba(255,255,255,0.87)",
  },
  loading: {
    minHeight: "100vh",
    background: "#1a1a1a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "rgba(255,255,255,0.4)",
  },
  nav: {
    position: "sticky" as const,
    top: 0,
    zIndex: 20,
    background: "rgba(26,26,26,0.95)",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    padding: "0 24px",
    height: "56px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    boxSizing: "border-box" as const,
  },
  logo: {
    fontWeight: 800,
    fontSize: "1.1rem",
    textDecoration: "none",
    background: "linear-gradient(135deg, #646cff, #a855f7)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
  },
  navActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: "12px",
  },
  balancePill: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    padding: "6px 14px",
    fontSize: "0.9rem",
    color: "rgba(255,255,255,0.87)",
  },
  logoutButton: {
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "8px",
    padding: "6px 14px",
    background: "transparent",
    color: "rgba(255,255,255,0.6)",
    cursor: "pointer",
    fontSize: "0.9rem",
  },
  content: {
    maxWidth: "960px",
    margin: "0 auto",
    padding: "32px 24px",
    boxSizing: "border-box" as const,
  },
  hello: {
    fontSize: "1.5rem",
    fontWeight: 700,
    color: "rgba(255,255,255,0.87)",
    marginBottom: "8px",
  },
  subtitle: {
    color: "rgba(255,255,255,0.4)",
    marginBottom: "32px",
  },
  actionsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "16px",
    marginBottom: "32px",
  },
  actionCard: {
    borderRadius: "16px",
    padding: "24px",
    cursor: "pointer",
  },
  actionIcon: {
    fontSize: "2rem",
    marginBottom: "12px",
  },
  actionTitle: {
    fontSize: "1.1rem",
    fontWeight: 700,
    color: "#ffffff",
  },
  actionDescription: {
    color: "rgba(255,255,255,0.5)",
    fontSize: "0.85rem",
    marginTop: "4px",
  },
  depositCard: {
    background: "#242424",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.08)",
    padding: "24px",
    marginBottom: "24px",
  },
  depositTitle: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "#ffffff",
    marginBottom: "16px",
  },
  depositText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: "0.85rem",
    marginBottom: "12px",
  },
  depositControls: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap" as const,
  },
  amountChip: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    padding: "8px 16px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "0.9rem",
  },
  amountInput: {
    width: "120px",
    padding: "8px 12px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    color: "rgba(255,255,255,0.87)",
    fontSize: "0.9rem",
    boxSizing: "border-box" as const,
  },
  depositButton: {
    background: "linear-gradient(135deg, #646cff, #a855f7)",
    border: "none",
    borderRadius: "8px",
    padding: "8px 20px",
    color: "#ffffff",
    fontWeight: 600,
    cursor: "pointer",
    marginLeft: "8px",
  },
  depositError: {
    marginTop: "10px",
    color: "#ef4444",
    fontSize: "0.85rem",
  },
  sectionTitle: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "rgba(255,255,255,0.6)",
    marginBottom: "12px",
  },
  activityPlaceholder: {
    background: "#242424",
    borderRadius: "12px",
    padding: "24px",
    textAlign: "center" as const,
    color: "rgba(255,255,255,0.3)",
    fontSize: "0.9rem",
    border: "1px solid rgba(255,255,255,0.08)",
  },
} as const;

function formatBalance(centsValue: string): string {
  const parsed = Number(centsValue);
  if (!Number.isFinite(parsed)) {
    return "0.00";
  }
  return (parsed / 100).toFixed(2);
}

export function DashboardPage(): ReactElement {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [userRole, setUserRole] = useState<string>("");
  const [balance, setBalance] = useState("0.00");
  const [loading, setLoading] = useState(true);
  const [depositAmount, setDepositAmount] = useState(20);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositLoading, setDepositLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadData = async (): Promise<void> => {
      try {
        const me = await getMe();
        if (!isMounted) {
          return;
        }
        setEmail(me.email);
        setUserRole(me.role);

        try {
          const wallet = await getWallet();
          if (!isMounted) {
            return;
          }
          setBalance(formatBalance(wallet.balance));
        } catch {
          if (!isMounted) {
            return;
          }
          setBalance("0.00");
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          clearToken();
          navigate("/login", { replace: true });
          return;
        }
        navigate("/login", { replace: true });
        return;
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  if (loading) {
    return <div style={styles.loading}>Ładowanie...</div>;
  }

  const emailPrefix = email.split("@")[0] ?? "";
  const quickAmounts = [10, 20, 50, 100];

  const handleDeposit = async (): Promise<void> => {
    setDepositError(null);
    if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
      setDepositError("Podaj poprawną kwotę doładowania.");
      return;
    }

    setDepositLoading(true);
    try {
      // PRODUKCJA: zastąpić prawdziwą integracją Autopay/BLIK
      const result = await initiateDeposit(Math.round(depositAmount * 100));
      if (result.paymentUrl.length > 0) {
        window.location.href = result.paymentUrl;
        return;
      }
      setDepositError("Brak linku płatności od operatora.");
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.status === 401) {
        clearToken();
        navigate("/login", { replace: true });
        return;
      }
      if (caughtError instanceof Error) {
        setDepositError(caughtError.message);
      } else {
        setDepositError("Nie udało się rozpocząć doładowania.");
      }
    } finally {
      setDepositLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <nav style={styles.nav}>
        <Link to="/" style={styles.logo}>
          {"\u26A1"} SkillGaming
        </Link>
        <div style={styles.navActions}>
          <div style={styles.balancePill}>{"\u{1F4B0}"} {balance} PLN</div>
          <button
            type="button"
            style={styles.logoutButton}
            onClick={() => {
              clearToken();
              navigate("/");
            }}
          >
            Wyloguj
          </button>
        </div>
      </nav>

      <main style={styles.content}>
        <div style={styles.hello}>Cześć, {emailPrefix}! {"\u{1F44B}"}</div>
        <div style={styles.subtitle}>Co dzisiaj gramy?</div>

        <section style={styles.actionsGrid}>
          <div
            style={{
              ...styles.actionCard,
              background: "linear-gradient(135deg, rgba(100,108,255,0.15), rgba(168,85,247,0.15))",
              border: "1px solid rgba(100,108,255,0.3)",
            }}
            onClick={() => {
              navigate("/turnieje");
            }}
          >
            <div style={styles.actionIcon}>{"\u{1F3C6}"}</div>
            <div style={styles.actionTitle}>Turnieje</div>
            <div style={styles.actionDescription}>Dołącz do turnieju i walcz o pulę nagród</div>
          </div>

          <div
            style={{
              ...styles.actionCard,
              background: "linear-gradient(135deg, rgba(168,85,247,0.15), rgba(100,108,255,0.15))",
              border: "1px solid rgba(168,85,247,0.3)",
            }}
            onClick={() => {
              navigate("/trade");
            }}
          >
            <div style={styles.actionIcon}>{"\u{1F512}"}</div>
            <div style={styles.actionTitle}>Bezpieczna wymiana</div>
            <div style={styles.actionDescription}>Kup lub sprzedaj item z gwarancją escrow</div>
          </div>
        </section>

        <section style={styles.depositCard}>
          <div style={styles.depositTitle}>💳 Doładuj portfel</div>
          <div style={styles.depositText}>Wybierz kwotę doładowania:</div>
          <div style={styles.depositControls}>
            {quickAmounts.map((amount) => (
              <button
                key={amount}
                type="button"
                style={{
                  ...styles.amountChip,
                  borderColor: depositAmount === amount ? "#a855f7" : "rgba(255,255,255,0.1)",
                }}
                onClick={() => {
                  setDepositAmount(amount);
                }}
              >
                {amount} PLN
              </button>
            ))}
            <input
              type="number"
              placeholder="Inna kwota"
              value={Number.isFinite(depositAmount) ? String(depositAmount) : ""}
              style={styles.amountInput}
              onChange={(event) => {
                const value = Number(event.target.value);
                setDepositAmount(Number.isFinite(value) ? value : 0);
              }}
            />
            <button
              type="button"
              style={{ ...styles.depositButton, opacity: depositLoading ? 0.6 : 1 }}
              disabled={depositLoading}
              onClick={() => {
                void handleDeposit();
              }}
            >
              Doładuj
            </button>
          </div>
          {depositError !== null && <div style={styles.depositError}>{depositError}</div>}
        </section>

        <section>
          <div style={styles.sectionTitle}>Ostatnia aktywność</div>
          <div style={styles.activityPlaceholder}>Brak aktywności. Dołącz do turnieju lub zrób wymianę!</div>
          {userRole === "ADMIN" && (
            <Link
              to="/admin"
              style={{
                display: "inline-block",
                marginTop: "16px",
                padding: "8px 16px",
                background: "rgba(168,85,247,0.1)",
                border: "1px solid rgba(168,85,247,0.3)",
                borderRadius: "8px",
                color: "#a855f7",
                textDecoration: "none",
                fontSize: "0.85rem",
              }}
            >
              ⚙️ Panel Admina
            </Link>
          )}
        </section>
      </main>
    </div>
  );
}
