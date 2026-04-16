import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  cancelTrade,
  confirmTrade,
  getMe,
  getTrade,
  getToken,
  payTrade,
  type MeResponse,
  type TradeDetail,
  type TradeStatus,
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
  linkMuted: {
    color: "rgba(255,255,255,0.5)",
    fontSize: "0.9rem",
    textDecoration: "none",
  },
  content: {
    maxWidth: "560px",
    margin: "0 auto",
    padding: "32px 24px",
    boxSizing: "border-box" as const,
  },
  title: {
    fontSize: "1.35rem",
    fontWeight: 700,
    color: "#ffffff",
    marginBottom: "8px",
    lineHeight: 1.3,
  },
  meta: {
    color: "rgba(255,255,255,0.45)",
    fontSize: "0.88rem",
    marginBottom: "20px",
  },
  badge: {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: "999px",
    fontSize: "0.78rem",
    fontWeight: 600,
    marginBottom: "20px",
  },
  amount: {
    fontSize: "2rem",
    fontWeight: 800,
    color: "#ffffff",
    marginBottom: "8px",
  },
  amountSub: {
    fontSize: "0.85rem",
    color: "rgba(255,255,255,0.45)",
    marginBottom: "24px",
  },
  card: {
    background: "#242424",
    borderRadius: "16px",
    border: "1px solid rgba(255,255,255,0.08)",
    padding: "24px",
    marginBottom: "20px",
    boxSizing: "border-box" as const,
  },
  desc: {
    color: "rgba(255,255,255,0.75)",
    fontSize: "0.95rem",
    lineHeight: 1.55,
    whiteSpace: "pre-wrap" as const,
  },
  error: {
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.35)",
    borderRadius: "10px",
    padding: "12px 16px",
    color: "#f87171",
    marginBottom: "16px",
    fontSize: "0.9rem",
  },
  btnPrimary: {
    width: "100%",
    padding: "14px",
    borderRadius: "10px",
    border: "none",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer",
    marginBottom: "10px",
  },
  btnDanger: {
    width: "100%",
    padding: "12px",
    borderRadius: "10px",
    border: "1px solid rgba(239,68,68,0.4)",
    background: "transparent",
    color: "#f87171",
    fontSize: "0.95rem",
    cursor: "pointer",
  },
  centered: {
    textAlign: "center" as const,
    padding: "48px 16px",
    color: "rgba(255,255,255,0.5)",
  },
  countdown: {
    fontSize: "0.95rem",
    color: "rgba(250,204,21,0.95)",
    marginBottom: "16px",
    fontVariantNumeric: "tabular-nums" as const,
  },
} as const;

function formatPlnFromCents(cents: string): string {
  const n = Number.parseInt(cents, 10);
  if (!Number.isFinite(n)) {
    return "0,00 PLN";
  }
  return `${(n / 100).toFixed(2).replace(".", ",")} PLN`;
}

function statusLabel(status: TradeStatus): string {
  const map: Record<TradeStatus, string> = {
    PENDING_PAYMENT: "Oczekuje na płatność",
    PAID_AWAITING_ITEM: "Opłacone — oczekuje na przedmiot",
    COMPLETED: "Zakończone",
    CANCELLED: "Anulowane",
    DISPUTED: "Spór",
  };
  return map[status] ?? status;
}

function badgeColors(
  status: TradeStatus,
  expiredPending: boolean,
): { bg: string; color: string; border: string } {
  if (expiredPending) {
    return {
      bg: "rgba(239,68,68,0.12)",
      color: "#f87171",
      border: "1px solid rgba(239,68,68,0.35)",
    };
  }
  switch (status) {
    case "PENDING_PAYMENT":
      return {
        bg: "rgba(250,204,21,0.12)",
        color: "#facc15",
        border: "1px solid rgba(250,204,21,0.35)",
      };
    case "PAID_AWAITING_ITEM":
      return {
        bg: "rgba(59,130,246,0.15)",
        color: "#60a5fa",
        border: "1px solid rgba(59,130,246,0.35)",
      };
    case "COMPLETED":
      return {
        bg: "rgba(34,197,94,0.12)",
        color: "#4ade80",
        border: "1px solid rgba(34,197,94,0.35)",
      };
    case "CANCELLED":
      return {
        bg: "rgba(239,68,68,0.12)",
        color: "#f87171",
        border: "1px solid rgba(239,68,68,0.35)",
      };
    case "DISPUTED":
      return {
        bg: "rgba(249,115,22,0.12)",
        color: "#fb923c",
        border: "1px solid rgba(249,115,22,0.35)",
      };
    default:
      return {
        bg: "rgba(255,255,255,0.06)",
        color: "rgba(255,255,255,0.6)",
        border: "1px solid rgba(255,255,255,0.1)",
      };
  }
}

export function TradeViewPage(): ReactElement {
  const { tradeId: tradeIdParam } = useParams<{ tradeId: string }>();
  const navigate = useNavigate();
  const tradeId = tradeIdParam?.trim() ?? "";

  const [trade, setTrade] = useState<TradeDetail | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const loadTrade = useCallback(async (): Promise<void> => {
    if (tradeId.length === 0) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getTrade(tradeId);
      setTrade(data);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        setTrade(null);
        setError("Nie znaleziono tej transakcji.");
      } else {
        setError(caught instanceof Error ? caught.message : "Nie udało się wczytać.");
      }
    } finally {
      setLoading(false);
    }
  }, [tradeId]);

  useEffect(() => {
    void loadTrade();
  }, [loadTrade]);

  useEffect(() => {
    let mounted = true;
    const loadMe = async (): Promise<void> => {
      if (getToken() === null) {
        if (mounted) {
          setMe(null);
          setAuthLoading(false);
        }
        return;
      }
      try {
        const u = await getMe();
        if (mounted) {
          setMe(u);
        }
      } catch {
        if (mounted) {
          setMe(null);
        }
      } finally {
        if (mounted) {
          setAuthLoading(false);
        }
      }
    };
    void loadMe();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(t);
    };
  }, []);

  const expiredPending = useMemo(() => {
    if (trade === null || trade.status !== "PENDING_PAYMENT") {
      return false;
    }
    if (trade.expiresAt === null) {
      return false;
    }
    return new Date(trade.expiresAt).getTime() <= nowTick;
  }, [trade, nowTick]);

  const countdownText = useMemo(() => {
    if (trade === null || trade.status !== "PENDING_PAYMENT" || trade.expiresAt === null || expiredPending) {
      return null;
    }
    const end = new Date(trade.expiresAt).getTime();
    const ms = Math.max(0, end - nowTick);
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `Wygasa za: ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [trade, nowTick, expiredPending]);

  const isSeller =
    !authLoading && me !== null && trade !== null && me.id === trade.sellerId;
  const isBuyer =
    !authLoading && me !== null && trade !== null && trade.buyerId !== null && me.id === trade.buyerId;

  const canPay =
    !authLoading &&
    trade !== null &&
    trade.status === "PENDING_PAYMENT" &&
    !expiredPending &&
    me !== null &&
    !isSeller;

  const canConfirm =
    trade !== null && trade.status === "PAID_AWAITING_ITEM" && isBuyer === true;

  const canCancel =
    trade !== null &&
    isSeller &&
    (trade.status === "PENDING_PAYMENT" || trade.status === "PAID_AWAITING_ITEM");

  const handlePay = async (): Promise<void> => {
    if (getToken() === null) {
      navigate(`/login?next=${encodeURIComponent(`/trade/${tradeId}`)}`);
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      await payTrade(tradeId);
      await loadTrade();
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 402) {
          setError("Brak środków na portfelu — doładuj konto.");
        } else if (caught.status === 410) {
          setError("Oferta wygasła.");
        } else {
          setError(caught.message);
        }
      } else {
        setError("Płatność nie powiodła się.");
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirm = async (): Promise<void> => {
    setActionLoading(true);
    setError(null);
    try {
      await confirmTrade(tradeId);
      await loadTrade();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się potwierdzić.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async (): Promise<void> => {
    if (!window.confirm("Na pewno anulować ten trade?")) {
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      await cancelTrade(tradeId);
      await loadTrade();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się anulować.");
    } finally {
      setActionLoading(false);
    }
  };

  if (tradeId.length === 0) {
    return (
      <div style={styles.page}>
        <div style={styles.centered}>Brak identyfikatora transakcji.</div>
      </div>
    );
  }

  if (loading && trade === null && error === null) {
    return (
      <div style={styles.page}>
        <nav style={styles.nav}>
          <Link to="/" style={styles.logo}>
            {"\u26A1"} SkillGaming
          </Link>
        </nav>
        <div style={styles.centered}>Ładowanie…</div>
      </div>
    );
  }

  if (trade === null) {
    return (
      <div style={styles.page}>
        <nav style={styles.nav}>
          <Link to="/" style={styles.logo}>
            {"\u26A1"} SkillGaming
          </Link>
        </nav>
        <div style={styles.content}>
          <div style={styles.error}>{error ?? "Nie znaleziono."}</div>
          <Link to="/" style={{ color: "#a855f7" }}>
            Strona główna
          </Link>
        </div>
      </div>
    );
  }

  const bc = badgeColors(trade.status, expiredPending);

  return (
    <div style={styles.page}>
      <nav style={styles.nav}>
        <Link to="/" style={styles.logo}>
          {"\u26A1"} SkillGaming
        </Link>
        <div style={styles.navActions}>
          {getToken() !== null ? (
            <Link to="/dashboard" style={styles.linkMuted}>
              Panel
            </Link>
          ) : (
            <Link to={`/login?next=${encodeURIComponent(`/trade/${tradeId}`)}`} style={styles.linkMuted}>
              Zaloguj
            </Link>
          )}
        </div>
      </nav>

      <main style={styles.content}>
        <div
          style={{
            ...styles.badge,
            background: bc.bg,
            color: bc.color,
            border: bc.border,
          }}
        >
          {expiredPending && trade.status === "PENDING_PAYMENT" ? "Wygasła (nieopłacona)" : statusLabel(trade.status)}
        </div>

        <h1 style={styles.title}>{trade.itemName}</h1>
        <div style={styles.meta}>
          Sprzedawca: <span style={{ color: "rgba(255,255,255,0.65)" }}>{trade.sellerEmail}</span>
        </div>

        <div style={styles.amount}>{formatPlnFromCents(trade.amountCents)}</div>
        <div style={styles.amountSub}>
          Prowizja platformy: {formatPlnFromCents(trade.platformFeeCents)} (pobierana przy finalizacji)
        </div>

        {countdownText !== null && <div style={styles.countdown}>{countdownText}</div>}

        {trade.description !== null && trade.description.trim().length > 0 && (
          <section style={styles.card}>
            <div style={styles.desc}>{trade.description}</div>
          </section>
        )}

        {error !== null && <div style={styles.error}>{error}</div>}

        {canPay && (
          <button
            type="button"
            style={{
              ...styles.btnPrimary,
              background: "linear-gradient(135deg, #22c55e, #16a34a)",
              opacity: actionLoading ? 0.65 : 1,
            }}
            disabled={actionLoading}
            onClick={() => void handlePay()}
          >
            {actionLoading ? "Przetwarzanie…" : "Zapłać bezpiecznie"}
          </button>
        )}

        {!authLoading &&
          trade.status === "PENDING_PAYMENT" &&
          !expiredPending &&
          getToken() === null && (
          <Link
            to={`/login?next=${encodeURIComponent(`/trade/${tradeId}`)}`}
            style={{
              ...styles.btnPrimary,
              display: "block",
              textAlign: "center",
              textDecoration: "none",
              background: "linear-gradient(135deg, #646cff, #a855f7)",
              lineHeight: "inherit",
            }}
          >
            Zaloguj się, aby zapłacić
          </Link>
        )}

        {canConfirm && (
          <button
            type="button"
            style={{
              ...styles.btnPrimary,
              background: "linear-gradient(135deg, #3b82f6, #2563eb)",
              opacity: actionLoading ? 0.65 : 1,
            }}
            disabled={actionLoading}
            onClick={() => void handleConfirm()}
          >
            {actionLoading ? "Przetwarzanie…" : "Potwierdzam odbiór"}
          </button>
        )}

        {canCancel && (
          <button
            type="button"
            style={{ ...styles.btnDanger, opacity: actionLoading ? 0.65 : 1 }}
            disabled={actionLoading}
            onClick={() => void handleCancel()}
          >
            Anuluj trade
          </button>
        )}
      </main>
    </div>
  );
}
