import type { FormEvent, ReactElement } from "react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, login } from "../lib/api";

function EyeIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 3l18 18M10.58 10.58a3 3 0 104.24 4.24M9.88 5.09A10.94 10.94 0 0112 5c6.5 0 10 7 10 7a18.5 18.5 0 01-3.16 4.67M6.12 6.12A18.5 18.5 0 003 12s3.5 7 10 7a9.74 9.74 0 005.09-1.38" />
    </svg>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#1a1a1a",
    color: "rgba(255,255,255,0.87)",
    padding: "24px",
    boxSizing: "border-box" as const,
  },
  card: {
    width: "100%",
    maxWidth: "400px",
    padding: "48px",
    background: "#242424",
    borderRadius: "16px",
    border: "1px solid rgba(255,255,255,0.08)",
    boxSizing: "border-box" as const,
  },
  logo: {
    display: "block",
    textAlign: "center" as const,
    marginBottom: "8px",
    fontWeight: 800,
    fontSize: "1.5rem",
    textDecoration: "none",
    background: "linear-gradient(135deg, #646cff, #a855f7)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
  },
  subtitle: {
    color: "rgba(255,255,255,0.45)",
    textAlign: "center" as const,
    fontSize: "0.9rem",
    marginBottom: "32px",
  },
  error: {
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: "8px",
    padding: "12px 16px",
    color: "#ef4444",
    fontSize: "0.9rem",
    marginBottom: "16px",
  },
  label: {
    display: "block",
    color: "rgba(255,255,255,0.6)",
    fontSize: "0.85rem",
    marginBottom: "6px",
  },
  input: {
    width: "100%",
    padding: "12px 16px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    color: "rgba(255,255,255,0.87)",
    fontSize: "1rem",
    outline: "none",
    boxSizing: "border-box" as const,
  },
  passwordWrap: {
    position: "relative" as const,
    marginBottom: "24px",
  },
  passwordInput: {
    width: "100%",
    padding: "12px 44px 12px 16px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    color: "rgba(255,255,255,0.87)",
    fontSize: "1rem",
    outline: "none",
    boxSizing: "border-box" as const,
  },
  eyeButton: {
    position: "absolute" as const,
    right: "12px",
    top: "50%",
    transform: "translateY(-50%)",
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.6)",
    cursor: "pointer",
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  submit: {
    width: "100%",
    padding: "14px",
    background: "linear-gradient(135deg, #646cff, #a855f7)",
    border: "none",
    borderRadius: "8px",
    color: "#ffffff",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  registerLink: {
    color: "#a855f7",
    fontSize: "0.9rem",
    textAlign: "center" as const,
    display: "block",
    marginTop: "24px",
    textDecoration: "none",
  },
} as const;

export function LoginPage(): ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [focusedField, setFocusedField] = useState<"email" | "password" | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (!email.includes("@") || !email.includes(".")) {
      setError("Podaj poprawny adres e-mail.");
      return;
    }

    if (password.trim().length === 0) {
      setError("Hasło nie może być puste.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await login(email, password);
      const next = searchParams.get("next");
      const target =
        typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
      navigate(target, { replace: true });
    } catch (caughtError) {
      if (caughtError instanceof ApiError) {
        setError(caughtError.message);
      } else if (caughtError instanceof TypeError) {
        setError("Brak połączenia z serwerem.");
      } else {
        setError("Wystąpił nieoczekiwany błąd.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <Link to="/" style={styles.logo}>
          {"\u26A1"} SkillGaming
        </Link>
        <div style={styles.subtitle}>Zaloguj się do swojego konta</div>

        {error !== null && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <label htmlFor="login-email" style={styles.label}>
            E-mail
          </label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            onFocus={() => {
              setFocusedField("email");
            }}
            onBlur={() => {
              setFocusedField((current) => (current === "email" ? null : current));
            }}
            autoComplete="email"
            style={{
              ...styles.input,
              borderColor: focusedField === "email" ? "#a855f7" : "rgba(255,255,255,0.1)",
              marginBottom: "16px",
            }}
          />

          <label htmlFor="login-password" style={styles.label}>
            Hasło
          </label>
          <div style={styles.passwordWrap}>
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              onFocus={() => {
                setFocusedField("password");
              }}
              onBlur={() => {
                setFocusedField((current) => (current === "password" ? null : current));
              }}
              autoComplete="current-password"
              style={{
                ...styles.passwordInput,
                borderColor: focusedField === "password" ? "#a855f7" : "rgba(255,255,255,0.1)",
              }}
            />
            <button
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                setShowPassword((current) => !current);
              }}
              style={styles.eyeButton}
              aria-label={showPassword ? "Ukryj hasło" : "Pokaż hasło"}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>

          <button type="submit" disabled={submitting} style={{ ...styles.submit, opacity: submitting ? 0.6 : 1 }}>
            {submitting ? "Logowanie..." : "Zaloguj się"}
          </button>
        </form>

        <Link to="/rejestracja" style={styles.registerLink}>
          Nie masz konta? Zarejestruj się
        </Link>
      </div>
    </div>
  );
}
