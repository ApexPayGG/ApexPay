import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  adminFundWallet,
  adminGetUsers,
  ApiError,
  clearToken,
  getMe,
  getWallet,
  type UserWallet,
} from "../lib/api";

const styles = {
  page: {
    minHeight: "100vh",
    background: "#1a1a1a",
    color: "rgba(255,255,255,0.87)",
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
  title: {
    fontSize: "1.5rem",
    fontWeight: 700,
    color: "#ffffff",
    marginBottom: "8px",
  },
  subtitle: {
    color: "rgba(255,255,255,0.4)",
    fontSize: "0.9rem",
    marginBottom: "32px",
  },
  card: {
    background: "#242424",
    borderRadius: "12px",
    padding: "24px",
    border: "1px solid rgba(255,255,255,0.08)",
    marginBottom: "24px",
  },
  cardTitle: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "#ffffff",
    marginBottom: "16px",
  },
  fundRow: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
  },
  input: {
    padding: "10px 12px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    color: "rgba(255,255,255,0.87)",
    fontSize: "0.9rem",
    boxSizing: "border-box" as const,
  },
  fundButton: {
    padding: "10px 24px",
    border: "none",
    borderRadius: "8px",
    background: "linear-gradient(135deg, #646cff, #a855f7)",
    color: "#ffffff",
    fontWeight: 600,
    cursor: "pointer",
  },
  success: {
    color: "#22c55e",
    fontSize: "0.85rem",
    marginTop: "8px",
  },
  error: {
    color: "#ef4444",
    fontSize: "0.85rem",
    marginTop: "8px",
  },
  usersCard: {
    background: "#242424",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  usersHead: {
    padding: "20px 24px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    fontSize: "1rem",
    fontWeight: 600,
    color: "#ffffff",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
  },
  headRow: {
    background: "rgba(255,255,255,0.03)",
  },
  th: {
    padding: "10px 16px",
    textAlign: "left" as const,
    color: "rgba(255,255,255,0.4)",
    fontSize: "0.8rem",
    fontWeight: 500,
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  tr: {
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  },
  td: {
    padding: "12px 16px",
    fontSize: "0.85rem",
    color: "rgba(255,255,255,0.8)",
  },
  roleBadge: {
    borderRadius: "4px",
    padding: "2px 8px",
    fontSize: "0.75rem",
    border: "1px solid rgba(255,255,255,0.1)",
  },
  idCell: {
    fontFamily: "monospace",
    fontSize: "0.75rem",
    color: "rgba(255,255,255,0.3)",
    maxWidth: "120px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    display: "block",
  },
  useIdButton: {
    background: "rgba(100,108,255,0.1)",
    border: "1px solid rgba(100,108,255,0.3)",
    borderRadius: "6px",
    padding: "4px 10px",
    color: "#646cff",
    fontSize: "0.8rem",
    cursor: "pointer",
  },
  centeredMessage: {
    textAlign: "center" as const,
    padding: "32px",
  },
} as const;

function formatBalance(cents: string): string {
  const n = Number.parseInt(cents, 10);
  if (!Number.isFinite(n)) {
    return "0.00 PLN";
  }
  return `${(n / 100).toFixed(2)} PLN`;
}

export function AdminPage(): ReactElement {
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserWallet[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targetUserId, setTargetUserId] = useState("");
  const [fundAmount, setFundAmount] = useState(50);
  const [fundLoading, setFundLoading] = useState(false);
  const [fundSuccess, setFundSuccess] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const [balance, setBalance] = useState("0.00");

  useEffect(() => {
    let mounted = true;
    const loadData = async (): Promise<void> => {
      try {
        const me = await getMe();
        if (!mounted) {
          return;
        }
        if (me.role !== "ADMIN") {
          navigate("/dashboard", { replace: true });
          return;
        }

        const [wallet, usersData] = await Promise.all([getWallet(), adminGetUsers()]);
        if (!mounted) {
          return;
        }
        setBalance((Number.parseInt(wallet.balance, 10) / 100).toFixed(2));
        setUsers(usersData.items);
        setTotal(usersData.total);
        setError(null);
      } catch (caughtError) {
        if (!mounted) {
          return;
        }
        if (caughtError instanceof ApiError && (caughtError.status === 401 || caughtError.status === 403)) {
          clearToken();
          navigate("/login", { replace: true });
          return;
        }
        setError(caughtError instanceof Error ? caughtError.message : "Nie udało się pobrać danych.");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    void loadData();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  const handleFund = async (): Promise<void> => {
    setFundLoading(true);
    setFundError(null);
    setFundSuccess(false);
    try {
      await adminFundWallet(targetUserId.trim(), Math.round(fundAmount * 100));
      setFundSuccess(true);
      const [usersData, wallet] = await Promise.all([adminGetUsers(), getWallet()]);
      setUsers(usersData.items);
      setTotal(usersData.total);
      setBalance((Number.parseInt(wallet.balance, 10) / 100).toFixed(2));
    } catch (caughtError) {
      if (caughtError instanceof ApiError) {
        setFundError(caughtError.message);
      } else if (caughtError instanceof Error) {
        setFundError(caughtError.message);
      } else {
        setFundError("Nie udało się doładować portfela.");
      }
    } finally {
      setFundLoading(false);
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
        <div style={styles.title}>{"\u2699\uFE0F"} Panel Admina</div>
        <div style={styles.subtitle}>Zarządzaj użytkownikami i portfelami</div>

        <section style={styles.card}>
          <div style={styles.cardTitle}>{"\u{1F4B0}"} Doładuj portfel użytkownika</div>
          <div style={styles.fundRow}>
            <input
              placeholder="ID użytkownika"
              style={{ ...styles.input, flex: 1 }}
              value={targetUserId}
              onChange={(event) => {
                setTargetUserId(event.target.value);
                setFundSuccess(false);
              }}
            />
            <input
              type="number"
              placeholder="Kwota PLN"
              min={1}
              max={10000}
              style={{ ...styles.input, width: "140px" }}
              value={Number.isFinite(fundAmount) ? String(fundAmount) : ""}
              onChange={(event) => {
                const value = Number(event.target.value);
                setFundAmount(Number.isFinite(value) ? value : 0);
                setFundSuccess(false);
              }}
            />
            <button
              type="button"
              style={{ ...styles.fundButton, opacity: fundLoading ? 0.6 : 1 }}
              disabled={fundLoading || targetUserId.trim().length === 0}
              onClick={() => {
                void handleFund();
              }}
            >
              Doładuj
            </button>
          </div>
          {fundSuccess && <div style={styles.success}>✅ Doładowano pomyślnie</div>}
          {fundError !== null && <div style={styles.error}>{fundError}</div>}
        </section>

        <section style={styles.usersCard}>
          <div style={styles.usersHead}>{"\u{1F465}"} Użytkownicy ({total})</div>
          {loading ? (
            <div style={styles.centeredMessage}>Ładowanie...</div>
          ) : error !== null ? (
            <div style={{ ...styles.centeredMessage, color: "#ef4444" }}>{error}</div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr style={styles.headRow}>
                  <th style={styles.th}>Email</th>
                  <th style={styles.th}>Rola</th>
                  <th style={styles.th}>Saldo</th>
                  <th style={styles.th}>ID</th>
                  <th style={styles.th}>Akcja</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const balanceInt = Number.parseInt(user.balance, 10);
                  const balanceColor =
                    balanceInt > 0 ? "#22c55e" : balanceInt < 0 ? "#ef4444" : "rgba(255,255,255,0.4)";
                  const roleStyle =
                    user.role === "ADMIN"
                      ? {
                          background: "rgba(168,85,247,0.15)",
                          color: "#a855f7",
                          border: "1px solid rgba(168,85,247,0.3)",
                        }
                      : {
                          background: "rgba(255,255,255,0.05)",
                          color: "rgba(255,255,255,0.4)",
                          border: "1px solid rgba(255,255,255,0.1)",
                        };
                  return (
                    <tr key={user.userId} style={styles.tr}>
                      <td style={styles.td}>{user.email}</td>
                      <td style={styles.td}>
                        <span style={{ ...styles.roleBadge, ...roleStyle }}>{user.role}</span>
                      </td>
                      <td style={{ ...styles.td, color: balanceColor }}>{formatBalance(user.balance)}</td>
                      <td style={styles.td}>
                        <span style={styles.idCell} title={user.userId}>
                          {user.userId}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <button
                          type="button"
                          style={styles.useIdButton}
                          onClick={() => {
                            setTargetUserId(user.userId);
                            setFundSuccess(false);
                          }}
                        >
                          Użyj ID
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
