import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ApiError,
  clearToken,
  getMe,
  getWallet,
  joinTournament,
  listTournaments,
  type Tournament,
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
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "24px",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 700,
    color: "#ffffff",
  },
  newButton: {
    background: "linear-gradient(135deg, #646cff, #a855f7)",
    border: "none",
    borderRadius: "8px",
    padding: "10px 20px",
    color: "#ffffff",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "0.9rem",
  },
  loading: {
    color: "rgba(255,255,255,0.4)",
    textAlign: "center" as const,
    padding: "48px",
  },
  error: {
    color: "#ef4444",
    textAlign: "center" as const,
    padding: "48px",
  },
  emptyCard: {
    background: "#242424",
    borderRadius: "12px",
    padding: "48px",
    textAlign: "center" as const,
    border: "1px solid rgba(255,255,255,0.08)",
  },
  emptyIcon: {
    fontSize: "3rem",
    marginBottom: "16px",
  },
  emptyText: {
    color: "rgba(255,255,255,0.4)",
  },
  tournamentCard: {
    background: "#242424",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "12px",
    padding: "20px 24px",
    marginBottom: "12px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "16px",
  },
  tournamentTitle: {
    fontWeight: 600,
    color: "#ffffff",
    fontSize: "1rem",
  },
  meta: {
    color: "rgba(255,255,255,0.45)",
    fontSize: "0.85rem",
    marginTop: "6px",
  },
  joinButton: {
    background: "linear-gradient(135deg, #646cff, #a855f7)",
    border: "none",
    borderRadius: "8px",
    padding: "8px 20px",
    color: "#ffffff",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "0.9rem",
    whiteSpace: "nowrap" as const,
  },
  joinSuccess: {
    marginTop: "8px",
    color: "#22c55e",
    fontSize: "0.85rem",
  },
  joinError: {
    marginTop: "8px",
    color: "#ef4444",
    fontSize: "0.85rem",
  },
} as const;

function formatBalance(centsValue: string): string {
  const parsed = Number(centsValue);
  if (!Number.isFinite(parsed)) {
    return "0.00";
  }
  return (parsed / 100).toFixed(2);
}

function formatEntryFee(centsValue: string): string {
  const parsed = Number(centsValue);
  if (!Number.isFinite(parsed)) {
    return "0.00";
  }
  return (parsed / 100).toFixed(2);
}

function statusBadge(status: string): { text: string; color: string } {
  if (status === "REGISTRATION") {
    return { text: "🟢 Rejestracja otwarta", color: "#22c55e" };
  }
  if (status === "IN_PROGRESS") {
    return { text: "🔵 W trakcie", color: "#3b82f6" };
  }
  if (status === "COMPLETED") {
    return { text: "⚪ Zakończony", color: "rgba(255,255,255,0.4)" };
  }
  if (status === "CANCELED") {
    return { text: "🔴 Anulowany", color: "#ef4444" };
  }
  return { text: status, color: "rgba(255,255,255,0.5)" };
}

export function TournamentsPage(): ReactElement {
  const navigate = useNavigate();
  const [balance, setBalance] = useState("0.00");
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinSuccessId, setJoinSuccessId] = useState<string | null>(null);
  const [joinErrors, setJoinErrors] = useState<Record<string, string | null>>({});

  const handleUnauthorized = (): void => {
    clearToken();
    navigate("/login", { replace: true });
  };

  const loadTournaments = async (): Promise<void> => {
    const data = await listTournaments();
    setTournaments(data.data.items);
  };

  useEffect(() => {
    let isMounted = true;

    const loadPage = async (): Promise<void> => {
      try {
        await getMe();
        if (!isMounted) return;

        const wallet = await getWallet();
        if (!isMounted) return;
        setBalance(formatBalance(wallet.balance));

        await loadTournaments();
        if (!isMounted) return;
        setError(null);
      } catch (caughtError) {
        if (!isMounted) return;
        if (caughtError instanceof ApiError && caughtError.status === 401) {
          handleUnauthorized();
          return;
        }
        setError(caughtError instanceof Error ? caughtError.message : "Nie udało się pobrać turniejów.");
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadPage();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  const handleJoin = async (tournamentId: string): Promise<void> => {
    setJoiningId(tournamentId);
    setJoinSuccessId(null);
    setJoinErrors((current) => ({ ...current, [tournamentId]: null }));
    try {
      await joinTournament(tournamentId);
      await loadTournaments();
      const wallet = await getWallet();
      setBalance(formatBalance(wallet.balance));
      setJoinSuccessId(tournamentId);
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.status === 401) {
        handleUnauthorized();
        return;
      }
      const message = caughtError instanceof ApiError ? caughtError.message : "Nie udało się dołączyć do turnieju.";
      setJoinErrors((current) => ({ ...current, [tournamentId]: message }));
    } finally {
      setJoiningId(null);
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
        <section style={styles.headerRow}>
          <div style={styles.title}>Turnieje</div>
          <button
            type="button"
            style={styles.newButton}
            onClick={() => {
              navigate("/turnieje/nowy");
            }}
          >
            + Nowy turniej
          </button>
        </section>

        {loading && <div style={styles.loading}>Ładowanie turniejów...</div>}

        {!loading && error !== null && <div style={styles.error}>{error}</div>}

        {!loading && error === null && tournaments.length === 0 && (
          <div style={styles.emptyCard}>
            <div style={styles.emptyIcon}>{"\u{1F3C6}"}</div>
            <div style={styles.emptyText}>Brak turniejów. Bądź pierwszy i utwórz turniej!</div>
          </div>
        )}

        {!loading &&
          error === null &&
          tournaments.map((tournament) => {
            const badge = statusBadge(tournament.status);
            const joinError = joinErrors[tournament.tournamentId];
            const isJoining = joiningId === tournament.tournamentId;
            return (
              <div key={tournament.tournamentId}>
                <div style={styles.tournamentCard}>
                  <div>
                    <div style={styles.tournamentTitle}>{tournament.title}</div>
                    <div style={{ ...styles.meta, marginTop: "4px", color: badge.color }}>{badge.text}</div>
                    <div style={styles.meta}>
                      {tournament.currentPlayers}/{tournament.maxPlayers} graczy • Wpisowe:{" "}
                      {formatEntryFee(tournament.entryFeeCents)} PLN
                    </div>
                  </div>

                  {tournament.status === "REGISTRATION" && (
                    <button
                      type="button"
                      style={{ ...styles.joinButton, opacity: isJoining ? 0.6 : 1 }}
                      disabled={isJoining}
                      onClick={() => {
                        void handleJoin(tournament.tournamentId);
                      }}
                    >
                      Dołącz
                    </button>
                  )}
                </div>
                {joinSuccessId === tournament.tournamentId && (
                  <div style={styles.joinSuccess}>Dołączono! Wpisowe pobrane z portfela.</div>
                )}
                {joinError !== null && joinError !== undefined && <div style={styles.joinError}>{joinError}</div>}
              </div>
            );
          })}
      </main>
    </div>
  );
}
