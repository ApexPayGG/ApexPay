import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const styles = {
  page: {
    minHeight: "100vh",
    boxSizing: "border-box" as const,
    background: "#1a1a1a",
    color: "rgba(255,255,255,0.87)",
    fontFamily: "system-ui, sans-serif",
    display: "flex",
    flexDirection: "column" as const,
  },
  nav: {
    flex: "0 0 auto",
    position: "sticky" as const,
    top: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    flexWrap: "wrap" as const,
    padding: "16px 24px",
    backgroundColor: "rgba(26,26,26,0.85)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  navPaddingMobile: {
    padding: "12px 16px",
  },
  logo: {
    fontWeight: 800,
    fontSize: "1.15rem",
    textDecoration: "none",
    letterSpacing: "-0.02em",
    background: "linear-gradient(135deg, #646cff, #a855f7)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
  },
  navActions: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  linkGhost: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 18px",
    borderRadius: "8px",
    border: "1px solid #a855f7",
    color: "rgba(255,255,255,0.87)",
    textDecoration: "none",
    fontWeight: 600,
    fontSize: "0.95rem",
    backgroundColor: "transparent",
  },
  linkGhostNavMobile: {
    padding: "8px 14px",
    fontSize: "0.875rem",
  },
  linkGradient: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 18px",
    borderRadius: "8px",
    border: "none",
    background: "linear-gradient(135deg, #646cff, #a855f7)",
    color: "rgba(255,255,255,0.95)",
    textDecoration: "none",
    fontWeight: 700,
    fontSize: "0.95rem",
  },
  linkGradientNavMobile: {
    padding: "8px 14px",
    fontSize: "0.875rem",
  },
  main: {
    flex: "0 0 auto",
    display: "flex",
    flexDirection: "column" as const,
  },
  hero: {
    flex: "0 0 auto",
    minHeight: "auto",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    padding: "80px 24px 64px",
    maxWidth: "800px",
    margin: "0 auto",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 14px",
    borderRadius: "999px",
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "#a855f7",
    backgroundColor: "rgba(168,85,247,0.15)",
    border: "1px solid rgba(168,85,247,0.3)",
    marginBottom: "20px",
  },
  heroH1: {
    margin: 0,
    fontSize: "3.2em",
    fontWeight: 700,
    lineHeight: 1.1,
    letterSpacing: "-0.03em",
  },
  heroH1Mobile: {
    fontSize: "2.2em",
  },
  heroLine1: {
    display: "block",
    color: "#ffffff",
  },
  heroLine2: {
    display: "block",
    background: "linear-gradient(135deg, #646cff, #a855f7)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
  },
  heroSubtitle: {
    margin: "24px auto 0",
    maxWidth: "560px",
    color: "rgba(255,255,255,0.6)",
    fontSize: "1.1rem",
    lineHeight: 1.65,
  },
  heroCtas: {
    marginTop: "32px",
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "14px",
    justifyContent: "center",
    alignItems: "center",
  },
  ctaGradient: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "14px 32px",
    borderRadius: "8px",
    fontSize: "1.1em",
    fontWeight: 700,
    border: "none",
    textDecoration: "none",
    background: "linear-gradient(135deg, #646cff, #a855f7)",
    color: "rgba(255,255,255,0.95)",
  },
  ctaGhost: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "14px 28px",
    borderRadius: "8px",
    fontSize: "1.05em",
    fontWeight: 600,
    border: "1px solid rgba(168,85,247,0.5)",
    color: "rgba(255,255,255,0.87)",
    backgroundColor: "transparent",
    textDecoration: "none",
  },
  featuresWrap: {
    flex: "0 0 auto",
    maxWidth: "960px",
    margin: "0 auto",
    padding: "0 24px 72px",
  },
  featuresGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "24px",
  },
  featuresGridMobile: {
    gridTemplateColumns: "1fr",
  },
  featureCard: {
    backgroundColor: "#242424",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "16px",
    padding: "32px",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
  },
  featureCardHover: {
    transform: "translateY(-4px)",
    boxShadow: "0 0 32px rgba(168,85,247,0.2)",
  },
  featureIcon: {
    fontSize: "2em",
    lineHeight: 1,
    marginBottom: "16px",
  },
  featureTitle: {
    margin: 0,
    fontSize: "1.15rem",
    fontWeight: 700,
    color: "rgba(255,255,255,0.87)",
  },
  featureDesc: {
    margin: "12px 0 0",
    color: "rgba(255,255,255,0.45)",
    fontSize: "0.95rem",
    lineHeight: 1.65,
  },
  statsSection: {
    flex: "0 0 auto",
    padding: "64px 24px 0",
    backgroundColor: "rgba(255,255,255,0.02)",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  statsRow: {
    display: "flex",
    flexDirection: "row" as const,
    justifyContent: "center",
    alignItems: "center",
    gap: "64px",
    flexWrap: "wrap" as const,
  },
  statsRowMobile: {
    flexDirection: "column" as const,
    gap: "32px",
  },
  statBlock: {
    textAlign: "center" as const,
  },
  statNumber: {
    margin: 0,
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    fontSize: "3rem",
    fontWeight: 800,
    lineHeight: 1.2,
    display: "inline-block" as const,
    paddingTop: "0.06em",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.02em",
    background: "linear-gradient(135deg, #646cff, #a855f7)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
  },
  statLabel: {
    margin: "8px 0 0",
    fontSize: "0.9em",
    color: "rgba(255,255,255,0.45)",
  },
  footer: {
    flexShrink: 0,
    marginTop: "auto",
    padding: "32px 24px",
    color: "rgba(255,255,255,0.3)",
    fontSize: "0.85em",
    textAlign: "center" as const,
  },
} as const;

function useIsMobile(breakpointPx: number): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const update = (): void => {
      setIsMobile(mq.matches);
    };
    update();
    mq.addEventListener("change", update);
    return () => {
      mq.removeEventListener("change", update);
    };
  }, [breakpointPx]);

  return isMobile;
}

function IconTrophy(): ReactElement {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 9H4a2 2 0 01-2-2V5h4M18 9h2a2 2 0 002-2V5h-4M6 9a6 6 0 0012 0M6 9H4M18 9h2M12 15v4M8 19h8"
        stroke="#a855f7"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="9" r="3" fill="rgba(168,85,247,0.2)" stroke="#a855f7" strokeWidth="1.5" />
    </svg>
  );
}

function IconShield(): ReactElement {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l8 4v5c0 4.5-3.5 8.7-8 10C7.5 20.7 4 16.5 4 12V7l8-4z"
        fill="rgba(168,85,247,0.15)"
        stroke="#a855f7"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M9 12l2 2 4-4" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconBolt(): ReactElement {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M13 2L4.5 13.5H12L11 22L19.5 10.5H12L13 2z"
        fill="rgba(168,85,247,0.2)"
        stroke="#a855f7"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type FeatureCardProps = {
  icon: ReactNode;
  title: string;
  description: string;
};

function FeatureCard({ icon, title, description }: FeatureCardProps): ReactElement {
  const [hover, setHover] = useState(false);

  const base = styles.featureCard as CSSProperties;
  const hoverExtra = (hover ? styles.featureCardHover : {}) as CSSProperties;

  return (
    <article
      style={{ ...base, ...hoverExtra }}
      onMouseEnter={() => {
        setHover(true);
      }}
      onMouseLeave={() => {
        setHover(false);
      }}
    >
      <div style={styles.featureIcon} aria-hidden>
        {icon}
      </div>
      <h2 style={styles.featureTitle}>{title}</h2>
      <p style={styles.featureDesc}>{description}</p>
    </article>
  );
}

export function LandingPage(): ReactElement {
  const isMobile = useIsMobile(768);

  return (
    <div style={styles.page}>
      <nav
        style={{
          ...styles.nav,
          ...(isMobile ? styles.navPaddingMobile : {}),
        }}
      >
        <Link to="/" style={styles.logo}>
          {"\u26A1"} SkillGaming
        </Link>
        <div style={styles.navActions}>
          <Link
            to="/login"
            style={{
              ...styles.linkGhost,
              ...(isMobile ? styles.linkGhostNavMobile : {}),
            }}
          >
            Zaloguj się
          </Link>
          <Link
            to="/rejestracja"
            style={{
              ...styles.linkGradient,
              ...(isMobile ? styles.linkGradientNavMobile : {}),
            }}
          >
            Zarejestruj się
          </Link>
        </div>
      </nav>

      <main style={styles.main}>
        <section style={styles.hero}>
          <div style={styles.badge}>
            <span aria-hidden>{"\u{1F512}"}</span>
            <span>Escrow dla graczy</span>
          </div>
          <h1
            style={{
              ...styles.heroH1,
              ...(isMobile ? styles.heroH1Mobile : {}),
            }}
          >
            <span style={styles.heroLine1}>Graj. Wygrywaj.</span>
            <span style={styles.heroLine2}>Odbieraj kasę.</span>
          </h1>
          <p style={styles.heroSubtitle}>
            Pierwsza polska platforma z escrow dla graczy. Wpisowe trafia do sejfu — wypłata automatyczna po wygranej.
          </p>
          <div style={styles.heroCtas}>
            <Link to="/rejestracja" style={styles.ctaGradient}>
              Dołącz za darmo
            </Link>
            <Link to="/turnieje" style={styles.ctaGhost}>
              Zobacz turnieje
            </Link>
          </div>
        </section>

        <div style={styles.featuresWrap}>
          <div
            style={{
              ...styles.featuresGrid,
              ...(isMobile ? styles.featuresGridMobile : {}),
            }}
          >
            <FeatureCard
              icon={<IconTrophy />}
              title="Turnieje z escrow"
              description="Wpisowe blokowane w sejfie przed startem. Automatyczna wypłata dla zwycięzcy."
            />
            <FeatureCard
              icon={<IconShield />}
              title="Zero scamów"
              description="Kupujesz skina od gracza? Pieniądze czekają aż potwierdzisz odbiór. Koniec z Discordowymi oszustami."
            />
            <FeatureCard
              icon={<IconBolt />}
              title="BLIK w minuty"
              description="Wpisowe przez BLIK, wypłata na konto. Bez kart, bez czekania, bez bullshitu."
            />
          </div>
        </div>

        <section style={styles.statsSection}>
          <div
            style={{
              ...styles.statsRow,
              ...(isMobile ? styles.statsRowMobile : {}),
            }}
          >
            <div style={styles.statBlock}>
              <p style={styles.statNumber}>2 137</p>
              <p style={styles.statLabel}>rozegranych turniejów</p>
            </div>
            <div style={styles.statBlock}>
              <p style={styles.statNumber}>187 450 PLN</p>
              <p style={styles.statLabel}>wypłaconych nagród</p>
            </div>
            <div style={styles.statBlock}>
              <p style={styles.statNumber}>12 849</p>
              <p style={styles.statLabel}>graczy</p>
            </div>
          </div>
        </section>
      </main>

      <footer style={styles.footer}>© 2025 SkillGaming</footer>
    </div>
  );
}
