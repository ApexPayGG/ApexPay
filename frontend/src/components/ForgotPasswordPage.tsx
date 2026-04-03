import { Link } from "react-router-dom";
import "./LoginPage.css";

/** Placeholder — backend reset hasła jeszcze niepodłączony. */
export function ForgotPasswordPage() {
  return (
    <div className="login-page">
      <div className="login-page__glow" aria-hidden />
      <div className="login-page__glow login-page__glow--secondary" aria-hidden />
      <div className="login-card">
        <h1 className="login-card__brand">Reset hasła</h1>
        <p className="login-card__tagline">
          Funkcja odzyskiwania hasła jest w przygotowaniu. Skontaktuj się z
          administratorem lub załóż nowe konto innym adresem e-mail.
        </p>
        <div className="login-links">
          <Link className="login-links__register" to="/login">
            Powrót do logowania
          </Link>
        </div>
      </div>
    </div>
  );
}
