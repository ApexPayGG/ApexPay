import { Banknote, Building2, KeyRound, Webhook } from "lucide-react";
import { NavLink } from "react-router-dom";

const linkClass =
  "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition";
const inactive =
  "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200";
const active =
  "border-violet-500/50 bg-violet-500/10 text-violet-200 ring-1 ring-violet-500/25";

export function IntegratorSubNav() {
  return (
    <nav
      className="mb-8 flex flex-wrap gap-2 border-b border-zinc-800 pb-4"
      aria-label="Sekcje panelu integratora"
    >
      <NavLink
        to="/panel/integrator/klucze-api"
        className={({ isActive }) => `${linkClass} ${isActive ? active : inactive}`}
      >
        <KeyRound className="h-4 w-4 shrink-0" aria-hidden />
        Klucze API
      </NavLink>
      <NavLink
        to="/panel/integrator/webhook"
        className={({ isActive }) => `${linkClass} ${isActive ? active : inactive}`}
      >
        <Webhook className="h-4 w-4 shrink-0" aria-hidden />
        Webhook
      </NavLink>
      <NavLink
        to="/panel/integrator/accounts"
        className={({ isActive }) => `${linkClass} ${isActive ? active : inactive}`}
      >
        <Building2 className="h-4 w-4 shrink-0" aria-hidden />
        Subkonta
      </NavLink>
      <NavLink
        to="/panel/integrator/payments"
        className={({ isActive }) => `${linkClass} ${isActive ? active : inactive}`}
      >
        <Banknote className="h-4 w-4 shrink-0" aria-hidden />
        Płatności
      </NavLink>
    </nav>
  );
}
