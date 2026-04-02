import { useId, useState, type FormEvent } from "react";
import {
  AuthApiError,
  loginWithPassword,
  persistAuthToken,
} from "../lib/auth-api.js";
import { useNavigate } from "react-router-dom";
import "./LoginPage.css";

function isValidEmail(value: string): boolean {
  const v = value.trim();
  if (v.length === 0) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function LoginPage() {
  const navigate = useNavigate();
  const formId = useId();
  const errorId = `${formId}-error`;
  const successId = `${formId}-success`;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fieldError = error !== null;

  function clearError(): void {
    setError(null);
  }

  function clearSuccess(): void {
    setSuccessMessage(null);
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    clearError();
    clearSuccess();

    if (!isValidEmail(email)) {
      setError("Podaj prawidłowy adres e-mail.");
      return;
    }
    if (password.length === 0) {
      setError("Hasło jest wymagane.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await loginWithPassword(email.trim(), password);
      persistAuthToken(result.token);
      setSuccessMessage(`Zalogowano pomyślnie. Witaj, ${result.email}.`);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      if (err instanceof AuthApiError) {
        setError(err.message);
      } else if (err instanceof TypeError) {
        setError(
          "Brak połączenia z serwerem. Uruchom backend (np. npm start w katalogu głównym) i odśwież stronę.",
        );
      } else {
        setError("Wystąpił nieoczekiwany błąd. Spróbuj ponownie.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const emptyFields = email.trim().length === 0 || password.length === 0;
  const disableSubmit = submitting || emptyFields;

  return (
    <div className="login-page">
      <div className="login-page__glow" aria-hidden />
      <div className="login-page__glow login-page__glow--secondary" aria-hidden />

      <div className="login-card">
        <h1 className="login-card__brand">ApexPay</h1>
        <p className="login-card__tagline">
          Bezpieczne logowanie do portfela i rozgrywki. Połączenie szyfrowane —
          Twoje dane chronimy tak samo jak saldo.
        </p>

        <div
          id={successId}
          className="login-success"
          role="status"
          aria-live="polite"
          hidden={successMessage === null}
        >
          <span className="login-success__icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M20 6L9 17l-5-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>{successMessage}</span>
        </div>

        <div
          id={errorId}
          className="login-error"
          role="alert"
          hidden={!fieldError}
        >
          <span className="login-error__icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span>{error}</span>
        </div>

        <form onSubmit={(ev) => void handleSubmit(ev)} noValidate>
          <div
            className={`login-field${fieldError ? " login-field--error" : ""}`}
          >
            <label className="login-field__label" htmlFor={`${formId}-email`}>
              E-mail
            </label>
            <input
              id={`${formId}-email`}
              className="login-field__input"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="twoj@email.pl"
              value={email}
              disabled={submitting}
              onChange={(ev) => {
                setEmail(ev.target.value);
                clearError();
                clearSuccess();
              }}
              aria-invalid={fieldError}
              aria-describedby={fieldError ? errorId : undefined}
            />
          </div>

          <div
            className={`login-field${fieldError ? " login-field--error" : ""}`}
          >
            <label className="login-field__label" htmlFor={`${formId}-password`}>
              Hasło
            </label>
            <div className="login-field__wrap login-field__wrap--password">
              <input
                id={`${formId}-password`}
                className="login-field__input"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                disabled={submitting}
                onChange={(ev) => {
                  setPassword(ev.target.value);
                  clearError();
                  clearSuccess();
                }}
                aria-invalid={fieldError}
                aria-describedby={fieldError ? errorId : undefined}
              />
              <button
                type="button"
                className="login-field__toggle"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Ukryj hasło" : "Pokaż hasło"}
                aria-pressed={showPassword}
                tabIndex={0}
                disabled={submitting}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className={`login-submit${submitting ? " login-submit--loading" : ""}`}
            disabled={disableSubmit}
            aria-busy={submitting}
          >
            {submitting ? "Logowanie…" : "Zaloguj się"}
          </button>
        </form>

        <div className="login-links">
          <a
            className="login-links__register"
            href="/rejestracja"
            onClick={(e) => e.preventDefault()}
          >
            Nie masz konta? Zarejestruj się
          </a>
          <a href="/zapomnialem-hasla" onClick={(e) => e.preventDefault()}>
            Zapomniałem hasła
          </a>
        </div>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 3l18 18M10.58 10.58a3 3 0 104.24 4.24M9.88 5.09A10.94 10.94 0 0112 5c6.5 0 10 7 10 7a18.5 18.5 0 01-3.16 4.67M6.12 6.12A18.5 18.5 0 003 12s3.5 7 10 7a9.74 9.74 0 005.09-1.38"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
