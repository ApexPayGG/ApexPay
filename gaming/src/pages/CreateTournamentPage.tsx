import type { FormEvent, ReactElement } from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, clearToken, createTournament, getMe, getWallet } from "../lib/api";

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
    maxWidth: "600px",
    margin: "0 auto",
    padding: "32px 24px",
    boxSizing: "border-box" as const,
  },
  backButton: {
    background: "transparent",
    border: "none",
    color: "rgba(255,255,255,0.5)",
    cursor: "pointer",
    fontSize: "0.9rem",
    padding: 0,
    marginBottom: "24px",
    display: "block",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 700,
    color: "#ffffff",
    marginBottom: "32px",
  },
  card: {
    background: "#242424",
    borderRadius: "16px",
    border: "1px solid rgba(255,255,255,0.08)",
    padding: "32px",
    boxSizing: "border-box" as const,
  },
  label: {
    display: "block",
    color: "rgba(255,255,255,0.7)",
    fontSize: "0.9rem",
    marginBottom: "8px",
  },
  input: {
    width: "100%",
    padding: "12px 16px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    color: "rgba(255,255,255,0.87)",
    fontSize: "1rem",
    marginBottom: "20px",
    boxSizing: "border-box" as const,
  },
  select: {
    width: "100%",
    padding: "12px 16px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    color: "rgba(255,255,255,0.87)",
    fontSize: "1rem",
    marginBottom: "20px",
    boxSizing: "border-box" as const,
    appearance: "none" as const,
  },
  hint: {
    color: "rgba(255,255,255,0.3)",
    fontSize: "0.8rem",
    marginTop: "-14px",
    marginBottom: "20px",
  },
  error: {
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: "8px",
    padding: "12px 16px",
    color: "#ef4444",
    marginBottom: "20px",
  },
  success: {
    background: "rgba(34,197,94,0.1)",
    border: "1px solid rgba(34,197,94,0.3)",
    borderRadius: "8px",
    padding: "12px 16px",
    color: "#22c55e",
    marginBottom: "20px",
  },
  submit: {
    width: "100%",
    background: "linear-gradient(135deg, #646cff, #a855f7)",
    border: "none",
    borderRadius: "8px",
    padding: "14px",
    color: "#ffffff",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer",
  },
} as const;

function formatBalance(centsValue: string): string {
  const parsed = Number(centsValue);
  if (!Number.isFinite(parsed)) {
    return "0.00";
  }
  return (parsed / 100).toFixed(2);
}

export function CreateTournamentPage(): ReactElement {
  const navigate = useNavigate();
  const [balance, setBalance] = useState("0.00");
  const [title, setTitle] = useState("");
  const [entryFee, setEntryFee] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [registrationHours, setRegistrationHours] = useState(48);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async (): Promise<void> => {
      try {
        await getMe();
        if (!mounted) return;
        const wallet = await getWallet();
        if (!mounted) return;
        setBalance(formatBalance(wallet.balance));
      } catch (caughtError) {
        if (!mounted) return;
        if (caughtError instanceof ApiError && caughtError.status === 401) {
          clearToken();
          navigate("/login", { replace: true });
          return;
        }
      }
    };

    void bootstrap();

    return () => {
      mounted = false;
    };
  }, [navigate]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (title.trim().length < 3) {
      setError("Nazwa musi mieć min. 3 znaki.");
      return;
    }

    const parsedFee = Number.parseFloat(entryFee);
    if (!Number.isFinite(parsedFee) || parsedFee < 1 || parsedFee > 500) {
      setError("Wpisowe musi być między 1 a 500 PLN.");
      return;
    }

    const entryFeeCents = Math.round(parsedFee * 100);
    setSubmitting(true);

    try {
      await createTournament({
        title: title.trim(),
        entryFeeCents,
        maxPlayers,
        registrationEndsInHours: registrationHours,
      });
      setSuccess(true);
      setTimeout(() => {
        navigate("/turnieje");
      }, 1500);
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.status === 401) {
        clearToken();
        navigate("/login", { replace: true });
        return;
      }
      if (caughtError instanceof ApiError) {
        setError(caughtError.message);
      } else {
        setError("Nie udało się utworzyć turnieju.");
      }
    } finally {
      setSubmitting(false);
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
        <button
          type="button"
          style={styles.backButton}
          onClick={() => {
            navigate("/turnieje");
          }}
        >
          ← Wróć
        </button>
        <div style={styles.title}>Nowy turniej</div>

        <form style={styles.card} onSubmit={handleSubmit}>
          <label htmlFor="title" style={styles.label}>
            Nazwa turnieju
          </label>
          <input
            id="title"
            type="text"
            placeholder="np. CS2 1v1 Wieczorny"
            maxLength={80}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            style={styles.input}
          />

          <label htmlFor="entryFee" style={styles.label}>
            Wpisowe (PLN)
          </label>
          <input
            id="entryFee"
            type="number"
            min="1"
            max="500"
            placeholder="np. 10"
            value={entryFee}
            onChange={(event) => {
              setEntryFee(event.target.value);
            }}
            style={styles.input}
          />
          <div style={styles.hint}>Minimalne wpisowe: 1 PLN. Maksymalne: 500 PLN.</div>

          <label htmlFor="maxPlayers" style={styles.label}>
            Liczba graczy
          </label>
          <select
            id="maxPlayers"
            value={String(maxPlayers)}
            onChange={(event) => {
              setMaxPlayers(Number(event.target.value));
            }}
            style={styles.select}
          >
            <option value="4">4</option>
            <option value="8">8</option>
            <option value="16">16</option>
            <option value="32">32</option>
          </select>

          <label htmlFor="registrationHours" style={styles.label}>
            Rejestracja otwarta przez
          </label>
          <select
            id="registrationHours"
            value={String(registrationHours)}
            onChange={(event) => {
              setRegistrationHours(Number(event.target.value));
            }}
            style={styles.select}
          >
            <option value="24">24 godziny</option>
            <option value="48">48 godzin</option>
            <option value="72">72 godziny</option>
          </select>

          {error !== null && <div style={styles.error}>{error}</div>}
          {success && <div style={styles.success}>Turniej utworzony! Przekierowuję...</div>}

          <button type="submit" style={{ ...styles.submit, opacity: submitting ? 0.6 : 1 }} disabled={submitting}>
            {submitting ? "Tworzenie..." : "Utwórz turniej"}
          </button>
        </form>
      </main>
    </div>
  );
}
