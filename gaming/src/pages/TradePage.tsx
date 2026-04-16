import type { FormEvent, ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ApiError,
  clearToken,
  createTrade,
  getMe,
  getWallet,
  listMyTrades,
  type TradeListItem,
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
    maxWidth: "720px",
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
    color: "rgba(255,255,255,0.45)",
    fontSize: "0.9rem",
    marginBottom: "32px",
  },
  card: {
    background: "#242424",
    borderRadius: "16px",
    border: "1px solid rgba(255,255,255,0.08)",
    padding: "32px",
    marginBottom: "24px",
    boxSizing: "border-box" as const,
  },
  sectionTitle: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "rgba(255,255,255,0.85)",
    marginBottom: "16px",
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
  textarea: {
    width: "100%",
    padding: "12px 16px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    color: "rgba(255,255,255,0.87)",
    fontSize: "1rem",
    marginBottom: "20px",
    boxSizing: "border-box" as const,
    resize: "none" as const,
  },
  error: {
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: "8px",
    padding: "12px 16px",
    color: "#ef4444",
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
  linkCard: {
    background: "rgba(34,197,94,0.08)",
    border: "1px solid rgba(34,197,94,0.3)",
    borderRadius: "12px",
    padding: "24px",
    marginTop: "24px",
  },
  linkHeader: {
    color: "#22c55e",
    fontWeight: 700,
    marginBottom: "12px",
  },
  linkHelp: {
    color: "rgba(255,255,255,0.5)",
    fontSize: "0.85rem",
    marginBottom: "16px",
  },
  linkBox: {
    background: "rgba(0,0,0,0.3)",
    borderRadius: "8px",
    padding: "12px 16px",
    fontFamily: "monospace",
    fontSize: "0.85rem",
    color: "rgba(255,255,255,0.8)",
    wordBreak: "break-all" as const,
    marginBottom: "12px",
  },
  copyButton: {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "8px",
    padding: "8px 20px",
    color: "#ffffff",
    cursor: "pointer",
  },
  howCard: {
    background: "#242424",
    borderRadius: "12px",
    padding: "24px",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  howTitle: {
    color: "rgba(255,255,255,0.6)",
    fontWeight: 600,
    marginBottom: "16px",
  },
  stepList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px",
  },
  stepRow: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
  },
  stepNumber: {
    minWidth: "24px",
    height: "24px",
    borderRadius: "50%",
    background: "linear-gradient(135deg, #646cff, #a855f7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "#ffffff",
  },
  stepText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: "0.9rem",
    lineHeight: 1.45,
  },
  listRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px 0",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  listTitle: {
    fontWeight: 600,
    color: "rgba(255,255,255,0.9)",
    fontSize: "0.92rem",
  },
  listMeta: {
    fontSize: "0.8rem",
    color: "rgba(255,255,255,0.45)",
    marginTop: "4px",
  },
  listLink: {
    color: "#a855f7",
    fontSize: "0.85rem",
    textDecoration: "none",
    whiteSpace: "nowrap" as const,
  },
  muted: {
    color: "rgba(255,255,255,0.45)",
    fontSize: "0.88rem",
  },
} as const;

function formatBalance(centsValue: string): string {
  const parsed = Number(centsValue);
  if (!Number.isFinite(parsed)) {
    return "0.00";
  }
  return (parsed / 100).toFixed(2);
}

function formatPln(cents: string): string {
  const n = Number.parseInt(cents, 10);
  if (!Number.isFinite(n)) {
    return "0,00 PLN";
  }
  return `${(n / 100).toFixed(2).replace(".", ",")} PLN`;
}

function statusShort(status: string): string {
  const m: Record<string, string> = {
    PENDING_PAYMENT: "Oczekuje",
    PAID_AWAITING_ITEM: "Opłacone",
    COMPLETED: "Zakończone",
    CANCELLED: "Anulowane",
    DISPUTED: "Spór",
  };
  return m[status] ?? status;
}

export function TradePage(): ReactElement {
  const navigate = useNavigate();
  const [balance, setBalance] = useState("0.00");
  const [title, setTitle] = useState("");
  const [pricePln, setPricePln] = useState("");
  const [description, setDescription] = useState("");
  const [tradeLink, setTradeLink] = useState<string | null>(null);
  const [lastTradeId, setLastTradeId] = useState<string | null>(null);
  const [myTrades, setMyTrades] = useState<TradeListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async (): Promise<void> => {
    setListLoading(true);
    try {
      const data = await listMyTrades(30);
      setMyTrades(data.items);
    } catch {
      setMyTrades([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async (): Promise<void> => {
      try {
        await getMe();
        if (!mounted) return;
        const wallet = await getWallet();
        if (!mounted) return;
        setBalance(formatBalance(wallet.balance));
        await refreshList();
      } catch (caughtError) {
        if (!mounted) return;
        if (caughtError instanceof ApiError && caughtError.status === 401) {
          clearToken();
          navigate("/login", { replace: true });
        }
      }
    };

    void bootstrap();

    return () => {
      mounted = false;
    };
  }, [navigate, refreshList]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setTradeLink(null);
    setCopied(false);
    setLastTradeId(null);

    if (title.trim().length < 3) {
      setError("Tytuł musi mieć min. 3 znaki.");
      return;
    }

    const parsedPrice = Number.parseFloat(pricePln.replace(",", "."));
    if (!Number.isFinite(parsedPrice) || parsedPrice < 1 || parsedPrice > 100_000) {
      setError("Kwota musi być między 1 a 100000 PLN.");
      return;
    }

    const amountCents = Math.round(parsedPrice * 100);
    if (amountCents < 100) {
      setError("Minimalna kwota to 1 PLN.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await createTrade({
        itemName: title.trim(),
        amountCents,
        ...(description.trim().length > 0 ? { description: description.trim() } : {}),
      });
      const publicLink = `${window.location.origin}/trade/${result.tradeId}`;
      setTradeLink(publicLink);
      setLastTradeId(result.tradeId);
      await refreshList();
    } catch (caughtError) {
      if (caughtError instanceof ApiError) {
        setError(caughtError.message);
      } else if (caughtError instanceof Error) {
        setError(caughtError.message);
      } else {
        setError("Nie udało się utworzyć transakcji.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (tradeLink === null) {
      return;
    }
    await navigator.clipboard.writeText(tradeLink);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
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
        <div style={styles.title}>{"\u{1F512}"} Bezpieczna wymiana</div>
        <div style={styles.subtitle}>
          Utwórz ofertę escrow — kupujący zapłaci z portfela ApexPay, środki zwolnisz po jego potwierdzeniu.
        </div>

        <form style={styles.card} onSubmit={handleSubmit}>
          <label htmlFor="trade-title" style={styles.label}>
            Tytuł oferty
          </label>
          <input
            id="trade-title"
            type="text"
            placeholder="np. AK-47 Redline FT"
            maxLength={256}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            style={styles.input}
          />

          <label htmlFor="trade-price" style={styles.label}>
            Kwota (PLN)
          </label>
          <input
            id="trade-price"
            type="number"
            min="1"
            step="0.01"
            placeholder="np. 85"
            value={pricePln}
            onChange={(event) => {
              setPricePln(event.target.value);
            }}
            style={styles.input}
          />

          <label htmlFor="trade-description" style={styles.label}>
            Opis (opcjonalny)
          </label>
          <textarea
            id="trade-description"
            placeholder="Dodatkowe informacje dla kupującego..."
            rows={3}
            maxLength={4000}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
            style={styles.textarea}
          />

          {error !== null && <div style={styles.error}>{error}</div>}

          <button type="submit" style={{ ...styles.submit, opacity: submitting ? 0.6 : 1 }} disabled={submitting}>
            {submitting ? "Tworzenie…" : "Utwórz link escrow"}
          </button>

          {tradeLink !== null && (
            <div style={styles.linkCard}>
              <div style={styles.linkHeader}>✅ Link gotowy</div>
              <div style={styles.linkHelp}>Wyślij ten link kupującemu. Płatność z portfela SkillGaming.</div>
              <div style={styles.linkBox}>{tradeLink}</div>
              <button type="button" style={styles.copyButton} onClick={() => void handleCopy()}>
                {copied ? "✓ Skopiowano!" : "Kopiuj link"}
              </button>
              {lastTradeId !== null && (
                <div style={{ marginTop: "16px" }}>
                  <Link to={`/trade/${lastTradeId}`} style={{ color: "#a855f7", fontSize: "0.9rem" }}>
                    Otwórz podgląd oferty →
                  </Link>
                </div>
              )}
            </div>
          )}
        </form>

        <section style={styles.card}>
          <div style={styles.sectionTitle}>Twoje ostatnie oferty</div>
          {listLoading ? (
            <div style={styles.muted}>Ładowanie listy…</div>
          ) : myTrades.length === 0 ? (
            <div style={styles.muted}>Brak utworzonych transakcji — dodaj pierwszą powyżej.</div>
          ) : (
            <div>
              {myTrades.map((t) => (
                <div key={t.tradeId} style={styles.listRow}>
                  <div>
                    <div style={styles.listTitle}>{t.itemName}</div>
                    <div style={styles.listMeta}>
                      {formatPln(t.amountCents)} · {statusShort(t.status)}
                    </div>
                  </div>
                  <Link to={`/trade/${t.tradeId}`} style={styles.listLink}>
                    Otwórz
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={styles.howCard}>
          <div style={styles.howTitle}>Jak to działa?</div>
          <div style={styles.stepList}>
            <div style={styles.stepRow}>
              <div style={styles.stepNumber}>1</div>
              <div style={styles.stepText}>Utwórz link i wyślij go kupującemu</div>
            </div>
            <div style={styles.stepRow}>
              <div style={styles.stepNumber}>2</div>
              <div style={styles.stepText}>Kupujący otwiera link i płaci z portfela — środki w escrow</div>
            </div>
            <div style={styles.stepRow}>
              <div style={styles.stepNumber}>3</div>
              <div style={styles.stepText}>Przekaż przedmiot; kupujący potwierdza odbiór — otrzymujesz wypłatę netto</div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
