import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Save,
  Webhook,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  apiUrl,
  AUTH_TOKEN_STORAGE_KEY,
  clearStoredAuthToken,
} from "../lib/auth-api.js";
import { IntegratorSubNav } from "./IntegratorSubNav.js";

type ConfigData = {
  id: string;
  userId: string;
  webhookUrl: string | null;
  webhookSecret: string;
  createdAt: string;
  updatedAt: string;
};

type GetResponse = {
  status: string;
  data: ConfigData | null;
};

type PutResponse = {
  status: string;
  data: ConfigData;
};

export function WebhookConfigManager() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copyErr, setCopyErr] = useState("");

  const getToken = useCallback((): string | null => {
    try {
      return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  }, []);

  const logout = useCallback(() => {
    clearStoredAuthToken();
    navigate("/login", { replace: true });
  }, [navigate]);

  const buildAuthHeaders = useCallback(
    (jsonBody: boolean): Record<string, string> => {
      const token = getToken();
      const h: Record<string, string> = { Accept: "application/json" };
      if (jsonBody) {
        h["Content-Type"] = "application/json";
      }
      if (token !== null && token.length > 0) {
        h.Authorization = `Bearer ${token}`;
      }
      return h;
    },
    [getToken],
  );

  const loadConfig = useCallback(async (): Promise<void> => {
    const token = getToken();
    if (token === null || token.length === 0) {
      logout();
      return;
    }

    setLoading(true);
    setError("");
    setSaveSuccess(false);
    try {
      const res = await fetch(apiUrl("/api/v1/integrations/config"), {
        headers: buildAuthHeaders(false),
        credentials: "include",
      });

      if (res.status === 401 || res.status === 403) {
        logout();
        return;
      }

      const text = await res.text();
      let body: unknown = {};
      if (text.length > 0) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          throw new Error("Nieprawidłowa odpowiedź serwera (nie JSON).");
        }
      }

      if (!res.ok) {
        const err = body as { error?: string };
        throw new Error(err.error ?? `Błąd ${res.status}`);
      }

      const parsed = body as GetResponse;
      const d = parsed.data;
      if (d === null) {
        setWebhookUrl("");
        setWebhookSecret(null);
      } else {
        setWebhookUrl(d.webhookUrl ?? "");
        setWebhookSecret(d.webhookSecret);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Nie udało się pobrać konfiguracji.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [buildAuthHeaders, getToken, logout]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const submitSave = async (): Promise<void> => {
    const token = getToken();
    if (token === null || token.length === 0) {
      logout();
      return;
    }

    const trimmed = webhookUrl.trim();
    let payload: { webhookUrl: string | null };
    if (trimmed.length === 0) {
      payload = { webhookUrl: null };
    } else {
      try {
        const u = new URL(trimmed);
        if (u.protocol !== "https:" && u.protocol !== "http:") {
          setError("URL musi zaczynać się od https:// lub http://.");
          return;
        }
      } catch {
        setError("Podaj prawidłowy adres URL (np. https://twoja-domena.pl/webhook).");
        return;
      }
      payload = { webhookUrl: trimmed };
    }

    setSaving(true);
    setError("");
    setSaveSuccess(false);
    try {
      const res = await fetch(apiUrl("/api/v1/integrations/config"), {
        method: "PUT",
        headers: buildAuthHeaders(true),
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (res.status === 401 || res.status === 403) {
        logout();
        return;
      }

      const text = await res.text();
      let body: unknown = {};
      if (text.length > 0) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          throw new Error("Nieprawidłowa odpowiedź serwera (nie JSON).");
        }
      }

      if (!res.ok) {
        const err = body as { error?: string; code?: string };
        throw new Error(err.error ?? `Błąd ${res.status}`);
      }

      const parsed = body as PutResponse;
      const d = parsed.data;
      setWebhookUrl(d.webhookUrl ?? "");
      setWebhookSecret(d.webhookSecret);
      setSaveSuccess(true);
      window.setTimeout(() => setSaveSuccess(false), 4000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Nie udało się zapisać.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const copySecret = async (): Promise<void> => {
    if (webhookSecret === null || webhookSecret.length === 0) return;
    setCopyErr("");
    try {
      await navigator.clipboard.writeText(webhookSecret);
      setCopiedSecret(true);
      window.setTimeout(() => setCopiedSecret(false), 2000);
    } catch {
      setCopyErr("Nie udało się skopiować — zaznacz tekst ręcznie.");
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0f0e] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(124,58,237,0.12),transparent)]" />

      <div className="relative mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Link
              to="/dashboard"
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700/80 bg-zinc-900/60 text-zinc-300 transition hover:border-violet-500/40 hover:bg-zinc-800/80 hover:text-white"
              aria-label="Wróć do pulpitu"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-violet-400/90">
                Panel integratora B2B
              </p>
              <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                <Webhook className="h-7 w-7 text-violet-400" aria-hidden />
                Webhook B2B
              </h1>
              <p className="mt-2 max-w-xl text-sm text-zinc-400">
                ApexPay wysyła zdarzenia (np. charge, payout) na podany URL metodą POST z nagłówkiem{" "}
                <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-violet-200">
                  x-apexpay-signature
                </code>{" "}
                (HMAC-SHA256 body).
              </p>
            </div>
          </div>
        </header>

        <IntegratorSubNav />

        {error.length > 0 && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {saveSuccess && (
          <div
            role="status"
            className="mb-6 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
          >
            Zapisano konfigurację webhooka.
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.7)] backdrop-blur-sm sm:p-8">
          <h2 className="text-sm font-medium text-zinc-200">Adres URL webhooka</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Pusty URL wyłącza wysyłkę (zapis jako null). Użyj HTTPS w produkcji.
          </p>

          {loading ? (
            <div className="mt-8 flex items-center justify-center gap-2 py-12 text-zinc-400">
              <Loader2 className="h-6 w-6 animate-spin text-violet-400" aria-hidden />
              <span>Ładowanie…</span>
            </div>
          ) : (
            <>
              <div className="mt-6">
                <label htmlFor="webhook-url" className="block text-xs font-medium text-zinc-400">
                  Adres URL Webhooka
                </label>
                <input
                  id="webhook-url"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="https://api.twoj-serwis.pl/apexpay/webhook"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  disabled={saving}
                  className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50"
                />
              </div>

              <div className="mt-6">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void submitSave()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-900/30 transition hover:bg-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f0e] disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Zapisywanie…
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Zapisz
                    </>
                  )}
                </button>
              </div>

              {webhookSecret !== null && webhookSecret.length > 0 && (
                <div className="mt-10 border-t border-zinc-800 pt-8">
                  <h3 className="text-sm font-medium text-zinc-200">Sekret podpisu (HMAC)</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Użyj tej wartości do weryfikacji nagłówka{" "}
                    <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px]">
                      x-apexpay-signature
                    </code>
                    . Nie udostępniaj go publicznie.
                  </p>

                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 font-mono text-xs text-zinc-300 sm:text-sm">
                      {secretVisible ? (
                        <span className="break-all">{webhookSecret}</span>
                      ) : (
                        <span className="text-zinc-500">
                          Kliknij „Pokaż”, aby wyświetlić sekret (traktuj go jak hasło).
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => setSecretVisible((v) => !v)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-600 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
                        aria-pressed={secretVisible}
                        aria-label={secretVisible ? "Ukryj sekret" : "Pokaż sekret"}
                      >
                        {secretVisible ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                        {secretVisible ? "Ukryj" : "Pokaż"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void copySecret()}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-white"
                      >
                        {copiedSecret ? (
                          <>
                            <Check className="h-4 w-4 text-emerald-600" />
                            Skopiowano
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4" />
                            Kopiuj
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  {copyErr.length > 0 && (
                    <p className="mt-2 text-xs text-red-400">{copyErr}</p>
                  )}
                </div>
              )}

              {!loading && webhookSecret === null && (
                <p className="mt-8 border-t border-zinc-800 pt-8 text-sm text-zinc-500">
                  Po pierwszym zapisie URL wygenerujemy sekret HMAC — pojawi się w tej sekcji.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
