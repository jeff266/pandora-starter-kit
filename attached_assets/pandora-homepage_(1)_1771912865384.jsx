import { useState, useEffect, useRef, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════
   PANDORA HOMEPAGE
   Dark-first landing page with waitlist + login/open app
   Sections: Hero, Stats, Transformations, Flow, Cadence, CTA
   ═══════════════════════════════════════════════════════════════ */

// ── Fonts ──
const display = "'DM Sans', 'Outfit', system-ui, sans-serif";
const mono = "'JetBrains Mono', 'Fira Code', monospace";

// ── Theme ──
const t = {
  bg: "#060611",
  bg2: "#0a0a18",
  surface: "#0f0f1e",
  surfaceAlt: "#141428",
  border: "#1a1a35",
  borderSubtle: "#12122a",
  text: "#eeeef5",
  textSec: "#8888a8",
  textMuted: "#55557a",
  accent: "#6366f1",
  accentLight: "#818cf8",
  accentGlow: "rgba(99,102,241,0.15)",
  cyan: "#22d3ee",
  cyanGlow: "rgba(34,211,238,0.12)",
  purple: "#a78bfa",
  purpleGlow: "rgba(167,139,250,0.12)",
  magenta: "#c084fc",
  green: "#34d399",
  greenBg: "rgba(52,211,153,0.08)",
  greenBorder: "rgba(52,211,153,0.2)",
  red: "#f87171",
  redBg: "rgba(248,113,113,0.08)",
  redBorder: "rgba(248,113,113,0.2)",
  yellow: "#fbbf24",
  orange: "#fb923c",
};

// ── Gradient helpers ──
const gradText = {
  background: `linear-gradient(135deg, ${t.purple} 0%, ${t.cyan} 50%, ${t.accentLight} 100%)`,
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  backgroundClip: "text",
};

// ── useInView hook ──
function useInView(opts = {}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: opts.threshold || 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, visible];
}

// ── Reveal wrapper ──
function Reveal({ children, delay = 0, style = {} }) {
  const [ref, visible] = useInView();
  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(24px)",
        transition: `opacity 0.7s ease ${delay}s, transform 0.7s ease ${delay}s`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Animated counter ──
function Counter({ end, suffix = "", duration = 2000 }) {
  const [ref, visible] = useInView();
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let start = 0;
    const step = end / (duration / 16);
    const id = setInterval(() => {
      start += step;
      if (start >= end) { setVal(end); clearInterval(id); }
      else setVal(Math.floor(start));
    }, 16);
    return () => clearInterval(id);
  }, [visible, end, duration]);
  return <span ref={ref}>{val}{suffix}</span>;
}

// ── Glowing orb (background decoration) ──
function Orb({ color, size, top, left, right, opacity = 0.12 }) {
  return (
    <div
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        opacity,
        top,
        left,
        right,
        filter: "blur(80px)",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}

// ── Section badge ──
function Badge({ children }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "5px 14px",
        fontSize: 11,
        fontWeight: 600,
        fontFamily: mono,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: t.cyan,
        background: t.cyanGlow,
        border: `1px solid rgba(34,211,238,0.2)`,
        borderRadius: 20,
      }}
    >
      {children}
    </span>
  );
}

// ══════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════
export default function PandoraHomepage() {
  const [email, setEmail] = useState("");
  const [waitlistStatus, setWaitlistStatus] = useState(null); // null | 'sending' | 'success' | 'error'
  const [waitlistMsg, setWaitlistMsg] = useState("");

  const handleWaitlist = useCallback(async (e) => {
    e.preventDefault();
    if (!email || !email.includes("@")) return;
    setWaitlistStatus("sending");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setWaitlistStatus("success");
        setWaitlistMsg("Thanks — I'll reach out personally to schedule your onboarding.");
        setEmail("");
      } else {
        const data = await res.json().catch(() => ({}));
        setWaitlistStatus("error");
        setWaitlistMsg(data.error || "Something went wrong. Try again.");
      }
    } catch {
      setWaitlistStatus("error");
      setWaitlistMsg("Network error. Try again.");
    }
  }, [email]);

  return (
    <div style={{ background: t.bg, color: t.text, fontFamily: display, minHeight: "100vh", overflowX: "hidden" }}>

      {/* ═══ GLOBAL STYLES ═══ */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=JetBrains+Mono:wght@400;500&family=Outfit:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body { background: ${t.bg}; }
        ::selection { background: ${t.accent}; color: white; }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes pulse-glow { 0%,100%{opacity:0.6} 50%{opacity:1} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        input::placeholder { color: ${t.textMuted}; }
      `}</style>

      {/* ═══ NAV ═══ */}
      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          padding: "0 32px",
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "rgba(6,6,17,0.85)",
          backdropFilter: "blur(16px)",
          borderBottom: `1px solid ${t.borderSubtle}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Logo mark - SVG recreation of the eye */}
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `linear-gradient(135deg, ${t.purple}22, ${t.cyan}22)`,
            border: `1px solid ${t.border}`,
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <defs>
                <linearGradient id="eyeGrad" x1="0" y1="0" x2="24" y2="24">
                  <stop offset="0%" stopColor={t.purple} />
                  <stop offset="50%" stopColor={t.magenta} />
                  <stop offset="100%" stopColor={t.cyan} />
                </linearGradient>
              </defs>
              <path
                d="M12 4C7 4 2.7 7.1 1 12c1.7 4.9 6 8 11 8s9.3-3.1 11-8c-1.7-4.9-6-8-11-8z"
                stroke="url(#eyeGrad)"
                strokeWidth="1.5"
                fill="none"
              />
              <circle cx="12" cy="12" r="3.5" stroke="url(#eyeGrad)" strokeWidth="1.5" fill="none" />
              <circle cx="12" cy="12" r="1.5" fill="url(#eyeGrad)" />
              {/* Circuit nodes */}
              {[[3,8],[5,5.5],[8,4.2],[16,4.2],[19,5.5],[21,8],[3,16],[5,18.5],[8,19.8],[16,19.8],[19,18.5],[21,16]].map(([cx,cy],i) => (
                <circle key={i} cx={cx} cy={cy} r="1" fill={i < 6 ? t.purple : t.cyan} opacity="0.7" />
              ))}
            </svg>
          </div>
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" }}>
            <span style={gradText}>pandora</span>
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a
            href="#waitlist"
            style={{
              padding: "8px 18px",
              fontSize: 13,
              fontWeight: 500,
              color: t.textSec,
              textDecoration: "none",
              borderRadius: 8,
              border: `1px solid ${t.border}`,
              background: "transparent",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => { e.target.style.borderColor = t.accent; e.target.style.color = t.text; }}
            onMouseLeave={(e) => { e.target.style.borderColor = t.border; e.target.style.color = t.textSec; }}
          >
            Join as Design Partner
          </a>
          <a
            href="/login"
            style={{
              padding: "8px 20px",
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              textDecoration: "none",
              borderRadius: 8,
              background: `linear-gradient(135deg, ${t.accent}, ${t.purple})`,
              cursor: "pointer",
              transition: "all 0.2s",
              boxShadow: `0 0 20px ${t.accentGlow}`,
            }}
            onMouseEnter={(e) => { e.target.style.boxShadow = `0 0 30px rgba(99,102,241,0.3)`; }}
            onMouseLeave={(e) => { e.target.style.boxShadow = `0 0 20px ${t.accentGlow}`; }}
          >
            Open App →
          </a>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section
        style={{
          position: "relative",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "120px 24px 80px",
          overflow: "hidden",
        }}
      >
        {/* Background orbs */}
        <Orb color={t.purple} size="600px" top="-200px" left="-200px" opacity={0.08} />
        <Orb color={t.cyan} size="500px" top="-100px" right="-200px" opacity={0.06} />
        <Orb color={t.accent} size="400px" top="50%" left="50%" opacity={0.04} />

        {/* Subtle grid */}
        <div style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(${t.border}33 1px, transparent 1px),
            linear-gradient(90deg, ${t.border}33 1px, transparent 1px)
          `,
          backgroundSize: "80px 80px",
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 70%)",
          opacity: 0.4,
          zIndex: 0,
        }} />

        <div style={{ position: "relative", zIndex: 1, maxWidth: 800 }}>
          <Reveal>
            <Badge>RevOps Intelligence Platform</Badge>
          </Reveal>

          <Reveal delay={0.1}>
            {/* Logo as hero element */}
            <div style={{
              margin: "40px auto 36px",
              width: 140,
              height: 140,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "float 6s ease-in-out infinite",
            }}>
              <svg width="140" height="90" viewBox="0 0 140 90" fill="none">
                <defs>
                  <linearGradient id="heroEyeGrad" x1="0" y1="0" x2="140" y2="90">
                    <stop offset="0%" stopColor={t.purple} />
                    <stop offset="40%" stopColor={t.magenta} />
                    <stop offset="100%" stopColor={t.cyan} />
                  </linearGradient>
                  <filter id="glow">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>
                {/* Eye outer shape */}
                <path
                  d="M70 10C40 10 15 30 5 45c10 15 35 35 65 35s55-20 65-35C125 30 100 10 70 10z"
                  stroke="url(#heroEyeGrad)"
                  strokeWidth="2.5"
                  fill="none"
                  filter="url(#glow)"
                />
                {/* Inner ring */}
                <circle cx="70" cy="45" r="18" stroke="url(#heroEyeGrad)" strokeWidth="2" fill="none" />
                {/* Iris vortex */}
                <path
                  d="M70 33 C76 33 82 38 82 45 C82 52 76 57 70 57 C64 57 58 52 58 45 C58 38 64 33 70 33"
                  stroke="url(#heroEyeGrad)"
                  strokeWidth="1.5"
                  fill="none"
                  opacity="0.6"
                />
                <circle cx="70" cy="45" r="8" fill="url(#heroEyeGrad)" opacity="0.3" />
                <circle cx="70" cy="45" r="4" fill="url(#heroEyeGrad)" opacity="0.8" />
                {/* Circuit nodes - left side */}
                {[
                  [12,30],[22,18],[35,12],[28,25],[18,40],
                  [12,58],[22,70],[35,78],[28,63],[18,50],
                ].map(([cx,cy],i) => (
                  <circle key={`l${i}`} cx={cx} cy={cy} r="2.5" fill={t.purple} opacity={0.6 + (i%3)*0.15}>
                    <animate attributeName="opacity" values={`${0.4+i*0.05};${0.8+i*0.03};${0.4+i*0.05}`} dur={`${2+i*0.3}s`} repeatCount="indefinite" />
                  </circle>
                ))}
                {/* Circuit nodes - right side */}
                {[
                  [128,30],[118,18],[105,12],[112,25],[122,40],
                  [128,58],[118,70],[105,78],[112,63],[122,50],
                ].map(([cx,cy],i) => (
                  <circle key={`r${i}`} cx={cx} cy={cy} r="2.5" fill={t.cyan} opacity={0.6 + (i%3)*0.15}>
                    <animate attributeName="opacity" values={`${0.4+i*0.05};${0.8+i*0.03};${0.4+i*0.05}`} dur={`${2.5+i*0.3}s`} repeatCount="indefinite" />
                  </circle>
                ))}
                {/* Connection lines */}
                <line x1="12" y1="30" x2="28" y2="25" stroke={t.purple} strokeWidth="0.8" opacity="0.3" />
                <line x1="22" y1="18" x2="35" y2="12" stroke={t.purple} strokeWidth="0.8" opacity="0.3" />
                <line x1="128" y1="30" x2="112" y2="25" stroke={t.cyan} strokeWidth="0.8" opacity="0.3" />
                <line x1="118" y1="18" x2="105" y2="12" stroke={t.cyan} strokeWidth="0.8" opacity="0.3" />
                <line x1="12" y1="58" x2="28" y2="63" stroke={t.purple} strokeWidth="0.8" opacity="0.3" />
                <line x1="128" y1="58" x2="112" y2="63" stroke={t.cyan} strokeWidth="0.8" opacity="0.3" />
              </svg>
            </div>
          </Reveal>

          <Reveal delay={0.2}>
            <h1 style={{
              fontSize: "clamp(40px, 6vw, 68px)",
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.035em",
              marginBottom: 20,
              fontFamily: "'Outfit', system-ui, sans-serif",
            }}>
              Stop guessing.<br />
              <span style={gradText}>Start seeing.</span>
            </h1>
          </Reveal>

          <Reveal delay={0.3}>
            <p style={{
              fontSize: "clamp(16px, 2vw, 20px)",
              color: t.textSec,
              maxWidth: 540,
              margin: "0 auto 40px",
              lineHeight: 1.6,
            }}>
              The RevOps analyst your team can't afford to hire.
              Connects your CRM, conversations, and GTM tools — delivers
              pipeline intelligence in Slack before your Monday standup.
            </p>
          </Reveal>

          <Reveal delay={0.4}>
            {/* Waitlist form - hero instance */}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", maxWidth: 460, margin: "0 auto" }}>
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleWaitlist(e)}
                style={{
                  flex: 1,
                  minWidth: 220,
                  padding: "14px 18px",
                  fontSize: 15,
                  fontFamily: display,
                  background: t.surface,
                  border: `1px solid ${t.border}`,
                  borderRadius: 10,
                  color: t.text,
                  outline: "none",
                  transition: "border-color 0.2s",
                }}
                onFocus={(e) => e.target.style.borderColor = t.accent}
                onBlur={(e) => e.target.style.borderColor = t.border}
              />
              <button
                onClick={handleWaitlist}
                disabled={waitlistStatus === "sending"}
                style={{
                  padding: "14px 28px",
                  fontSize: 15,
                  fontWeight: 600,
                  fontFamily: display,
                  color: "#fff",
                  background: `linear-gradient(135deg, ${t.accent}, ${t.purple})`,
                  border: "none",
                  borderRadius: 10,
                  cursor: waitlistStatus === "sending" ? "wait" : "pointer",
                  transition: "all 0.2s",
                  boxShadow: `0 4px 24px ${t.accentGlow}`,
                  whiteSpace: "nowrap",
                }}
              >
                {waitlistStatus === "sending" ? "Joining..." : "Become a Design Partner"}
              </button>
            </div>
            {waitlistMsg && (
              <p style={{
                marginTop: 12,
                fontSize: 13,
                color: waitlistStatus === "success" ? t.green : t.red,
                fontFamily: mono,
              }}>
                {waitlistMsg}
              </p>
            )}
          </Reveal>

          <Reveal delay={0.5}>
            <p style={{ fontSize: 12, color: t.textMuted, marginTop: 16 }}>
              Now onboarding design partners · white-glove setup · direct founder access
            </p>
          </Reveal>
        </div>

        {/* Scroll indicator */}
        <div style={{
          position: "absolute",
          bottom: 32,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          opacity: 0.4,
        }}>
          <span style={{ fontSize: 11, fontFamily: mono, color: t.textMuted }}>scroll</span>
          <div style={{ width: 1, height: 24, background: `linear-gradient(to bottom, ${t.textMuted}, transparent)` }} />
        </div>
      </section>

      {/* ═══ OUTCOME STATS ═══ */}
      <section style={{
        padding: "60px 24px",
        borderTop: `1px solid ${t.border}`,
        borderBottom: `1px solid ${t.border}`,
        background: t.bg2,
      }}>
        <div style={{
          maxWidth: 900,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 32,
          textAlign: "center",
        }}>
          {[
            { val: 38, suffix: "s", label: "avg analysis time", color: t.cyan },
            { val: 16, suffix: "", label: "live skills", color: t.purple },
            { val: 4, suffix: "¢", label: "per analysis run", color: t.green },
            { val: 10, suffix: "min", label: "to first insight", color: t.accentLight },
          ].map((s, i) => (
            <Reveal key={i} delay={i * 0.1}>
              <div>
                <div style={{ fontSize: "clamp(32px, 5vw, 48px)", fontWeight: 700, fontFamily: "'Outfit', sans-serif", color: s.color, letterSpacing: "-0.03em" }}>
                  <Counter end={s.val} />{s.suffix}
                </div>
                <div style={{ fontSize: 13, color: t.textMuted, fontFamily: mono, marginTop: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {s.label}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ═══ TRANSFORMATION 1: Remove the Blindfold ═══ */}
      <section style={{ padding: "100px 24px", position: "relative" }}>
        <Orb color={t.purple} size="400px" top="0" right="-150px" opacity={0.05} />
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <Reveal>
            <Badge>Remove the Blindfold</Badge>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 700, marginTop: 16, marginBottom: 12, letterSpacing: "-0.03em", fontFamily: "'Outfit', sans-serif" }}>
              Your pipeline has stories.<br />You're not hearing them.
            </h2>
            <p style={{ fontSize: 16, color: t.textSec, maxWidth: 560, marginBottom: 48, lineHeight: 1.65 }}>
              Deals stalling. Champions going dark. Competitors showing up in calls you didn't listen to. Pandora surfaces what's actually happening — with evidence.
            </p>
          </Reveal>

          {/* Before / After card */}
          <Reveal delay={0.15}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, borderRadius: 16, overflow: "hidden", border: `1px solid ${t.border}` }}>
              {/* Before */}
              <div style={{ background: t.surface, padding: "36px 32px" }}>
                <div style={{ fontSize: 11, fontFamily: mono, color: t.red, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 20, fontWeight: 600 }}>
                  Without Pandora
                </div>
                {[
                  "Manual deal reviews in spreadsheets",
                  "Stalled deals discovered too late",
                  "Pipeline coverage is a guess",
                  "Forecast based on gut feel",
                  "Competitor mentions buried in call logs",
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14 }}>
                    <span style={{ color: t.red, fontSize: 14, marginTop: 2, flexShrink: 0 }}>✕</span>
                    <span style={{ fontSize: 14, color: t.textSec, lineHeight: 1.5 }}>{item}</span>
                  </div>
                ))}
              </div>
              {/* After */}
              <div style={{ background: t.surfaceAlt, padding: "36px 32px" }}>
                <div style={{ fontSize: 11, fontFamily: mono, color: t.green, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 20, fontWeight: 600 }}>
                  With Pandora
                </div>
                {[
                  "AI-scored deal health with evidence trail",
                  "Risk alerts before deals slip stage",
                  "Real-time coverage + gap analysis",
                  "Monte Carlo forecast with confidence bands",
                  "Competitive intelligence extracted from every call",
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14 }}>
                    <span style={{ color: t.green, fontSize: 14, marginTop: 2, flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: 14, color: t.textSec, lineHeight: 1.5 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ TRANSFORMATION 2: Break the Handcuffs ═══ */}
      <section style={{ padding: "100px 24px", background: t.bg2, position: "relative" }}>
        <Orb color={t.cyan} size="400px" top="0" left="-150px" opacity={0.05} />
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <Reveal>
            <Badge>Break the Handcuffs</Badge>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 700, marginTop: 16, marginBottom: 12, letterSpacing: "-0.03em", fontFamily: "'Outfit', sans-serif" }}>
              Turn weeks of analysis<br />into minutes.
            </h2>
            <p style={{ fontSize: 16, color: t.textSec, maxWidth: 560, marginBottom: 48, lineHeight: 1.65 }}>
              Your RevOps team spends 60% of their time pulling data, formatting spreadsheets, and building slides. Pandora does it in seconds — with calculations you can audit.
            </p>
          </Reveal>

          <Reveal delay={0.15}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, borderRadius: 16, overflow: "hidden", border: `1px solid ${t.border}` }}>
              <div style={{ background: t.surface, padding: "36px 32px" }}>
                <div style={{ fontSize: 11, fontFamily: mono, color: t.red, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 20, fontWeight: 600 }}>
                  The old way
                </div>
                {[
                  "2 days to build a weekly pipeline review",
                  "Copy-paste from 5 different tools",
                  "Outdated by the time it reaches leadership",
                  "Custom Excel formulas nobody else understands",
                  "No audit trail on how numbers were calculated",
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14 }}>
                    <span style={{ color: t.red, fontSize: 14, marginTop: 2, flexShrink: 0 }}>✕</span>
                    <span style={{ fontSize: 14, color: t.textSec, lineHeight: 1.5 }}>{item}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: t.surfaceAlt, padding: "36px 32px" }}>
                <div style={{ fontSize: 11, fontFamily: mono, color: t.green, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 20, fontWeight: 600 }}>
                  With Pandora
                </div>
                {[
                  "Pipeline review in Slack every Monday 6am",
                  "Single source of truth across all GTM tools",
                  "Always-current, always-calculated, always-delivered",
                  "Excel + Word deliverables with full methodology",
                  '"Show your work" transparency on every metric',
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14 }}>
                    <span style={{ color: t.green, fontSize: 14, marginTop: 2, flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: 14, color: t.textSec, lineHeight: 1.5 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ CONNECTION FLOW ═══ */}
      <section style={{ padding: "100px 24px", position: "relative" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 56 }}>
              <Badge>Connect the Stack</Badge>
              <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 700, marginTop: 16, marginBottom: 12, letterSpacing: "-0.03em", fontFamily: "'Outfit', sans-serif" }}>
                Your systems finally<br /><span style={gradText}>talk to each other.</span>
              </h2>
              <p style={{ fontSize: 16, color: t.textSec, maxWidth: 480, margin: "0 auto", lineHeight: 1.65 }}>
                CRM, conversations, and enrichment data flow into one intelligence layer — no integration project required.
              </p>
            </div>
          </Reveal>

          {/* Flow diagram */}
          <Reveal delay={0.15}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr", gap: 0, alignItems: "center" }}>
              {/* Sources */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { name: "HubSpot", icon: "🟠" },
                  { name: "Salesforce", icon: "☁️" },
                  { name: "Gong", icon: "🎙" },
                  { name: "Fireflies", icon: "🔥" },
                  { name: "Apollo", icon: "🚀" },
                ].map((s, i) => (
                  <Reveal key={i} delay={0.1 + i * 0.05}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 16px",
                      background: t.surface,
                      border: `1px solid ${t.border}`,
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 500,
                    }}>
                      <span>{s.icon}</span>
                      <span>{s.name}</span>
                    </div>
                  </Reveal>
                ))}
              </div>

              {/* Arrow */}
              <div style={{ padding: "0 16px", color: t.textMuted, fontSize: 20 }}>→</div>

              {/* Pandora core */}
              <div style={{
                padding: 32,
                background: `linear-gradient(135deg, ${t.surface}, ${t.surfaceAlt})`,
                border: `1px solid ${t.border}`,
                borderRadius: 16,
                textAlign: "center",
                position: "relative",
                overflow: "hidden",
              }}>
                <div style={{
                  position: "absolute",
                  inset: 0,
                  background: `radial-gradient(circle at 50% 50%, ${t.accentGlow} 0%, transparent 70%)`,
                  pointerEvents: "none",
                }} />
                <div style={{ position: "relative", zIndex: 1 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>
                    <svg width="48" height="32" viewBox="0 0 48 32" fill="none" style={{ display: "inline-block" }}>
                      <path d="M24 4C14 4 6 12 2 16c4 4 12 12 22 12s18-8 22-12C42 12 34 4 24 4z" stroke="url(#eyeGrad)" strokeWidth="1.5" fill="none" />
                      <circle cx="24" cy="16" r="5" fill="url(#eyeGrad)" opacity="0.5" />
                      <circle cx="24" cy="16" r="2" fill="url(#eyeGrad)" />
                    </svg>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, ...gradText, marginBottom: 4 }}>pandora</div>
                  <div style={{ fontSize: 11, fontFamily: mono, color: t.textMuted }}>16 skills · 20 tools</div>
                  <div style={{ fontSize: 11, fontFamily: mono, color: t.textMuted, marginTop: 2 }}>Compute → Classify → Synthesize</div>
                </div>
              </div>

              {/* Arrow */}
              <div style={{ padding: "0 16px", color: t.textMuted, fontSize: 20 }}>→</div>

              {/* Outputs */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { name: "Slack Briefings", icon: "💬" },
                  { name: "Excel Reports", icon: "📊" },
                  { name: "Word Documents", icon: "📄" },
                  { name: "Command Center", icon: "🎯" },
                  { name: "API / Push", icon: "⚡" },
                ].map((s, i) => (
                  <Reveal key={i} delay={0.2 + i * 0.05}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 16px",
                      background: t.surface,
                      border: `1px solid ${t.border}`,
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 500,
                    }}>
                      <span>{s.icon}</span>
                      <span>{s.name}</span>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ CADENCE GRID ═══ */}
      <section style={{ padding: "100px 24px", background: t.bg2, position: "relative" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 56 }}>
              <Badge>RevOps in a Box</Badge>
              <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 700, marginTop: 16, letterSpacing: "-0.03em", fontFamily: "'Outfit', sans-serif" }}>
                Intelligence on your schedule.
              </h2>
            </div>
          </Reveal>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[
              {
                time: "Mon 6:00am",
                title: "Pipeline Intelligence",
                desc: "Deal scores, risk flags, coverage gaps, and rep performance — in Slack before standup.",
                color: t.cyan,
              },
              {
                time: "Fri 4:00pm",
                title: "Weekly Forecast",
                desc: "Monte Carlo projections, commit vs best-case ranges, and stage-by-stage waterfall analysis.",
                color: t.purple,
              },
              {
                time: "1st of month",
                title: "QBR Package",
                desc: "Win/loss patterns, ICP fit analysis, rep scorecards, and pipeline conversion trends — ready for leadership.",
                color: t.accentLight,
              },
              {
                time: "On demand",
                title: "Deep Dives",
                desc: "Ask a question, get an answer with evidence. Deal forensics, account dossiers, competitive intelligence.",
                color: t.green,
              },
            ].map((card, i) => (
              <Reveal key={i} delay={i * 0.1}>
                <div
                  style={{
                    padding: 28,
                    background: t.surface,
                    border: `1px solid ${t.border}`,
                    borderRadius: 14,
                    transition: "border-color 0.3s, box-shadow 0.3s",
                    cursor: "default",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = card.color + "66";
                    e.currentTarget.style.boxShadow = `0 0 30px ${card.color}11`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = t.border;
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <div style={{
                    display: "inline-block",
                    padding: "4px 10px",
                    fontSize: 11,
                    fontFamily: mono,
                    fontWeight: 600,
                    color: card.color,
                    background: card.color + "15",
                    borderRadius: 6,
                    marginBottom: 14,
                  }}>
                    {card.time}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, letterSpacing: "-0.01em" }}>
                    {card.title}
                  </div>
                  <div style={{ fontSize: 14, color: t.textSec, lineHeight: 1.6 }}>
                    {card.desc}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CREDIBILITY / PRACTITIONER PROOF ═══ */}
      <section style={{ padding: "100px 24px", position: "relative" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 48 }}>
              <Badge>Built by a Practitioner</Badge>
              <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 700, marginTop: 16, letterSpacing: "-0.03em", fontFamily: "'Outfit', sans-serif" }}>
                Not another AI demo.<br />
                <span style={gradText}>A real RevOps platform.</span>
              </h2>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div style={{
              padding: 36,
              background: t.surface,
              border: `1px solid ${t.border}`,
              borderRadius: 16,
              marginBottom: 32,
            }}>
              <p style={{ fontSize: 17, color: t.textSec, lineHeight: 1.7, fontStyle: "italic", marginBottom: 20 }}>
                "I built Pandora because I spent years doing this work manually — 
                pulling HubSpot exports, cross-referencing Gong calls, building forecast 
                models in Excel, and delivering them to leaders who needed the insight 
                yesterday. This isn't a toy. It's the analyst I wish I'd had."
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: `linear-gradient(135deg, ${t.accent}, ${t.purple})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  fontWeight: 700,
                  color: "white",
                }}>
                  J
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Jeff Ignacio</div>
                  <div style={{ fontSize: 12, color: t.textMuted }}>Founder · RevOps Impact Newsletter</div>
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.2}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              {[
                { val: "22K", label: "LinkedIn followers" },
                { val: "5,200", label: "Newsletter subscribers" },
                { val: "4", label: "Live client workspaces" },
              ].map((s, i) => (
                <div
                  key={i}
                  style={{
                    padding: 24,
                    background: t.surface,
                    border: `1px solid ${t.border}`,
                    borderRadius: 12,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 28, fontWeight: 700, color: t.accentLight, fontFamily: "'Outfit', sans-serif" }}>
                    {s.val}
                  </div>
                  <div style={{ fontSize: 12, color: t.textMuted, fontFamily: mono, marginTop: 4 }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ CTA + WAITLIST ═══ */}
      <section
        id="waitlist"
        style={{
          padding: "100px 24px",
          background: t.bg2,
          position: "relative",
          textAlign: "center",
        }}
      >
        <Orb color={t.accent} size="500px" top="-200px" left="50%" opacity={0.06} />
        <div style={{ maxWidth: 560, margin: "0 auto", position: "relative", zIndex: 1 }}>
          <Reveal>
            <h2 style={{
              fontSize: "clamp(28px, 4vw, 42px)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              fontFamily: "'Outfit', sans-serif",
              marginBottom: 12,
            }}>
              Ready to see your pipeline?
            </h2>
            <p style={{ fontSize: 16, color: t.textSec, marginBottom: 36, lineHeight: 1.6 }}>
              We onboard design partners hands-on — first analysis in under 10 minutes, direct Slack channel with the founder, and your input shapes the roadmap.
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleWaitlist(e)}
                style={{
                  flex: 1,
                  minWidth: 220,
                  padding: "14px 18px",
                  fontSize: 15,
                  fontFamily: display,
                  background: t.surface,
                  border: `1px solid ${t.border}`,
                  borderRadius: 10,
                  color: t.text,
                  outline: "none",
                  transition: "border-color 0.2s",
                }}
                onFocus={(e) => e.target.style.borderColor = t.accent}
                onBlur={(e) => e.target.style.borderColor = t.border}
              />
              <button
                onClick={handleWaitlist}
                disabled={waitlistStatus === "sending"}
                style={{
                  padding: "14px 28px",
                  fontSize: 15,
                  fontWeight: 600,
                  fontFamily: display,
                  color: "#fff",
                  background: `linear-gradient(135deg, ${t.accent}, ${t.purple})`,
                  border: "none",
                  borderRadius: 10,
                  cursor: waitlistStatus === "sending" ? "wait" : "pointer",
                  transition: "all 0.2s",
                  boxShadow: `0 4px 24px ${t.accentGlow}`,
                  whiteSpace: "nowrap",
                }}
              >
                {waitlistStatus === "sending" ? "Joining..." : "Become a Design Partner →"}
              </button>
            </div>
            {waitlistMsg && (
              <p style={{
                marginTop: 12,
                fontSize: 13,
                color: waitlistStatus === "success" ? t.green : t.red,
                fontFamily: mono,
              }}>
                {waitlistMsg}
              </p>
            )}
          </Reveal>

          <Reveal delay={0.2}>
            <div style={{ marginTop: 32, display: "flex", justifyContent: "center", gap: 24 }}>
              <a
                href="/login"
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: t.textSec,
                  textDecoration: "none",
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => e.target.style.color = t.text}
                onMouseLeave={(e) => e.target.style.color = t.textSec}
              >
                Already have access? Sign in →
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer
        style={{
          padding: "48px 24px 32px",
          borderTop: `1px solid ${t.border}`,
        }}
      >
        <div style={{
          maxWidth: 900,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr 1fr",
          gap: 40,
        }}>
          {/* Col 1: Brand */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <svg width="16" height="11" viewBox="0 0 48 32" fill="none">
                <defs>
                  <linearGradient id="footGrad" x1="0" y1="0" x2="48" y2="32">
                    <stop offset="0%" stopColor={t.purple} />
                    <stop offset="100%" stopColor={t.cyan} />
                  </linearGradient>
                </defs>
                <path d="M24 4C14 4 6 12 2 16c4 4 12 12 22 12s18-8 22-12C42 12 34 4 24 4z" stroke="url(#footGrad)" strokeWidth="2" fill="none" />
                <circle cx="24" cy="16" r="3" fill="url(#footGrad)" />
              </svg>
              <span style={{ fontSize: 14, fontWeight: 600, ...gradText }}>pandora</span>
            </div>
            <p style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.6, marginBottom: 16 }}>
              RevOps intelligence platform.
              <br />Built by a practitioner, for practitioners.
            </p>
            <span style={{ fontSize: 11, color: t.textMuted }}>© 2026 RevOps Impact</span>
          </div>

          {/* Col 2: Legal */}
          <div>
            <div style={{ fontSize: 11, fontFamily: mono, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14, fontWeight: 600 }}>
              Legal
            </div>
            {[
              { label: "Privacy Policy", href: "/privacy" },
              { label: "Terms of Service", href: "/terms" },
            ].map((link, i) => (
              <a
                key={i}
                href={link.href}
                style={{
                  display: "block",
                  fontSize: 13,
                  color: t.textMuted,
                  textDecoration: "none",
                  marginBottom: 10,
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => e.target.style.color = t.textSec}
                onMouseLeave={(e) => e.target.style.color = t.textMuted}
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Col 3: Connect */}
          <div>
            <div style={{ fontSize: 11, fontFamily: mono, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14, fontWeight: 600 }}>
              Connect
            </div>
            {[
              { label: "Newsletter", href: "https://revopsimpact.com", external: true },
              { label: "LinkedIn", href: "https://linkedin.com/in/jeffignacio", external: true },
              { label: "Contact", href: "mailto:jeff@revopsimpact.us", external: true },
            ].map((link, i) => (
              <a
                key={i}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noopener noreferrer" : undefined}
                style={{
                  display: "block",
                  fontSize: 13,
                  color: t.textMuted,
                  textDecoration: "none",
                  marginBottom: 10,
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => e.target.style.color = t.textSec}
                onMouseLeave={(e) => e.target.style.color = t.textMuted}
              >
                {link.label} {link.external ? "↗" : ""}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
