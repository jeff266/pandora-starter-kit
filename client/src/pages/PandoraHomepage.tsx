import { useState, useEffect, useRef } from "react";
import HubSpotForm from "../components/HubSpotForm";

const display = "'DM Sans', 'Outfit', system-ui, sans-serif";
const mono = "'JetBrains Mono', 'Fira Code', monospace";

function PandoraEyeLogo({ size = 24 }: { size?: number }) {
  const id = `eyeGrad_${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "inline-block" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="24" y2="24">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path d="M12 5C7 5 3 9 1 12c2 3 6 7 11 7s9-4 11-7c-2-3-6-7-11-7z" stroke={`url(#${id})`} strokeWidth="1.5" fill="none" />
      <circle cx="12" cy="12" r="3.5" stroke={`url(#${id})`} strokeWidth="1.5" fill="none" />
      <circle cx="12" cy="12" r="1.5" fill={`url(#${id})`} />
      {[[3,8],[5,5.5],[8,4.2],[16,4.2],[19,5.5],[21,8],[3,16],[5,18.5],[8,19.8],[16,19.8],[19,18.5],[21,16]].map(([cx,cy],i) => (
        <circle key={i} cx={cx} cy={cy} r="1" fill={i < 6 ? "#a78bfa" : "#22d3ee"} opacity="0.7" />
      ))}
    </svg>
  );
}

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

const gradText: React.CSSProperties = {
  background: `linear-gradient(135deg, ${t.purple} 0%, ${t.cyan} 50%, ${t.accentLight} 100%)`,
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  backgroundClip: "text",
};

function useInView(opts: { threshold?: number } = {}) {
  const ref = useRef<HTMLDivElement>(null);
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
  return [ref, visible] as const;
}

function Reveal({ children, delay = 0, style = {} }: { children: React.ReactNode; delay?: number; style?: React.CSSProperties }) {
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

function Counter({ end, suffix = "", duration = 2000 }: { end: number; suffix?: string; duration?: number }) {
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

function Orb({ color, size, top, left, right, opacity = 0.12 }: { color: string; size: string; top?: string; left?: string; right?: string; opacity?: number }) {
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

function Badge({ children }: { children: React.ReactNode }) {
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

export default function PandoraHomepage() {

  return (
    <div style={{ background: t.bg, color: t.text, fontFamily: display, minHeight: "100vh", overflowX: "hidden" }}>
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
          <img src="/pandora-logo.png" alt="Pandora" style={{ width: 32, height: 32, borderRadius: 8 }} />
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
            onMouseEnter={(e) => { (e.target as HTMLElement).style.borderColor = t.accent; (e.target as HTMLElement).style.color = t.text; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.borderColor = t.border; (e.target as HTMLElement).style.color = t.textSec; }}
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
            onMouseEnter={(e) => { (e.target as HTMLElement).style.boxShadow = `0 0 30px rgba(99,102,241,0.3)`; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.boxShadow = `0 0 20px ${t.accentGlow}`; }}
          >
            Open App →
          </a>
        </div>
      </nav>

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
        <Orb color={t.purple} size="600px" top="-200px" left="-200px" opacity={0.08} />
        <Orb color={t.cyan} size="500px" top="-100px" right="-200px" opacity={0.06} />
        <Orb color={t.accent} size="400px" top="50%" left="50%" opacity={0.04} />

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
            <div style={{
              margin: "40px auto 36px",
              width: 140,
              height: 140,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "float 6s ease-in-out infinite",
            }}>
              <img src="/pandora-logo.png" alt="Pandora" style={{ width: 140, height: 140, borderRadius: 24, boxShadow: `0 0 60px ${t.accentGlow}, 0 0 120px ${t.purpleGlow}` }} />
            </div>
          </Reveal>

          <Reveal delay={0.2}>
            <h1 style={{
              fontSize: "clamp(36px, 5.5vw, 64px)",
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.035em",
              marginBottom: 20,
              fontFamily: "'Outfit', system-ui, sans-serif",
            }}>
              The revenue operating system<br />
              your team has been{" "}
              <span style={{
                WebkitTextStroke: "1px rgba(255,255,255,0.28)",
                WebkitTextFillColor: "transparent",
                fontStyle: "normal",
              }}>duct-taping</span><br />
              together with{" "}
              <span style={{ ...gradText, position: "relative", display: "inline-block" }}>
                spreadsheets
                <span style={{
                  position: "absolute",
                  bottom: 4,
                  left: 0,
                  right: 0,
                  height: 3,
                  background: `linear-gradient(90deg, ${t.accent}, ${t.cyan})`,
                  borderRadius: 2,
                  display: "block",
                }} />
              </span>.
            </h1>
          </Reveal>

          <Reveal delay={0.3}>
            <p style={{
              fontSize: "clamp(16px, 2vw, 19px)",
              color: t.textSec,
              maxWidth: 560,
              margin: "0 auto 40px",
              lineHeight: 1.65,
            }}>
              Pandora connects your CRM, your calls, and your pipeline data into a single system
              that analyzes, alerts, and acts — without anyone asking it to.
            </p>
          </Reveal>

          <Reveal delay={0.4}>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <a
                href="#waitlist"
                style={{
                  display: "inline-block",
                  padding: "14px 32px",
                  fontSize: 15,
                  fontWeight: 600,
                  fontFamily: display,
                  color: "#fff",
                  background: `linear-gradient(135deg, ${t.accent}, ${t.purple})`,
                  border: "none",
                  borderRadius: 10,
                  cursor: "pointer",
                  transition: "all 0.2s",
                  boxShadow: `0 4px 24px ${t.accentGlow}`,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.88")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
              >
                Become a Design Partner →
              </a>
            </div>
          </Reveal>

          <Reveal delay={0.5}>
            <p style={{ fontSize: 12, color: t.textMuted, marginTop: 16 }}>
              Now onboarding design partners · white-glove setup · direct founder access
            </p>
          </Reveal>
        </div>

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
            { val: 4, suffix: "\u00A2", label: "per analysis run", color: t.green },
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

      <section style={{ padding: "100px 24px", position: "relative" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 48 }}>
              <Badge>Revenue Intelligence Platform</Badge>
              <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 700, marginTop: 16, marginBottom: 12, letterSpacing: "-0.03em", fontFamily: "'Outfit', sans-serif" }}>
                Know. Decide. Act.
              </h2>
              <p style={{ fontSize: 16, color: t.textSec, maxWidth: 500, margin: "0 auto", lineHeight: 1.65 }}>
                Pandora is more than seeing your pipeline or seeing your data. It's a complete Revenue Intelligence system.
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.15}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 2,
              borderRadius: 16,
              overflow: "hidden",
              border: `1px solid ${t.border}`,
            }}>
              {[
                {
                  verb: "Know",
                  color: t.accent,
                  title: "Full revenue visibility",
                  body: "Pipeline health, rep performance, account signals, and forecast accuracy — surfaced automatically across every deal in your CRM.",
                  tags: ["Pipeline health", "Rep scorecards", "ICP fit", "Stage velocity"],
                },
                {
                  verb: "Decide",
                  color: t.purple,
                  title: "Intelligence that reasons",
                  body: "Tri-signal scoring across ICP fit, behavioral engagement, and survival probability. Every recommendation is traceable to the data behind it.",
                  tags: ["Forecast accuracy", "Deal scoring", "Risk detection", "Win patterns"],
                },
                {
                  verb: "Act",
                  color: t.green,
                  title: "Automation that closes loops",
                  body: "CRM writebacks, Slack alerts, agent-driven playbooks. Pandora doesn't stop at the dashboard — it runs the follow-through your team doesn't have time for.",
                  tags: ["CRM writeback", "Slack delivery", "Agent playbooks", "Auto-cadences"],
                },
              ].map((pillar, i) => (
                <div
                  key={i}
                  style={{
                    background: t.surface,
                    padding: "40px 32px",
                    position: "relative",
                    transition: "background 0.3s ease",
                    borderRight: i < 2 ? `1px solid ${t.border}` : undefined,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#161b2e"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = t.surface; }}
                >
                  <div style={{
                    fontSize: 11,
                    fontFamily: mono,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: pillar.color,
                    marginBottom: 16,
                  }}>
                    {pillar.verb}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12, lineHeight: 1.2, fontFamily: "'Outfit', sans-serif" }}>
                    {pillar.title}
                  </div>
                  <p style={{ fontSize: 14, color: t.textSec, lineHeight: 1.65, marginBottom: 24 }}>
                    {pillar.body}
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {pillar.tags.map((tag, j) => (
                      <span key={j} style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: t.textMuted,
                        background: "rgba(255,255,255,0.04)",
                        border: `1px solid ${t.border}`,
                        borderRadius: 4,
                        padding: "3px 8px",
                        letterSpacing: "0.02em",
                      }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

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

          <Reveal delay={0.15}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, borderRadius: 16, overflow: "hidden", border: `1px solid ${t.border}` }}>
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

          <Reveal delay={0.15}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr", gap: 0, alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { name: "HubSpot", icon: "\uD83D\uDFE0" },
                  { name: "Salesforce", icon: "☁️" },
                  { name: "Gong", icon: "\uD83C\uDF99" },
                  { name: "Fireflies", icon: "\uD83D\uDD25" },
                  { name: "Apollo", icon: "\uD83D\uDE80" },
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

              <div style={{ padding: "0 16px", color: t.textMuted, fontSize: 20 }}>→</div>

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
                  <img src="/pandora-logo.png" alt="Pandora" style={{ width: 48, height: 48, borderRadius: 10, marginBottom: 8 }} />
                  <div style={{ fontSize: 16, fontWeight: 700, ...gradText, marginBottom: 4 }}>pandora</div>
                  <div style={{ fontSize: 11, fontFamily: mono, color: t.textMuted }}>16 skills · 20 tools</div>
                  <div style={{ fontSize: 11, fontFamily: mono, color: t.textMuted, marginTop: 2 }}>Compute → Classify → Synthesize</div>
                </div>
              </div>

              <div style={{ padding: "0 16px", color: t.textMuted, fontSize: 20 }}>→</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { name: "Slack Briefings", icon: "\uD83D\uDCAC" },
                  { name: "Excel Reports", icon: "\uD83D\uDCCA" },
                  { name: "Word Documents", icon: "\uD83D\uDCC4" },
                  { name: "Command Center", icon: "\uD83C\uDFAF" },
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

      <section style={{ padding: "100px 24px", position: "relative" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 48 }}>
              <Badge>Early Partners</Badge>
              <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 700, marginTop: 16, marginBottom: 12, letterSpacing: "-0.03em", fontFamily: "'Outfit', sans-serif" }}>
                What teams are saying
              </h2>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              {[
                {
                  quote: "We caught three at-risk deals in the first session that weren't on anyone's radar. Our weekly pipeline review used to take 90 minutes. Now it takes 15.",
                  initials: "RO",
                  name: "Head of RevOps",
                  role: "Series B SaaS, 180 employees",
                },
                {
                  quote: "I'm a team of one supporting 12 AEs. Pandora is the only tool that actually gives me time back instead of asking for more of it.",
                  initials: "SR",
                  name: "RevOps Manager",
                  role: "PLG SaaS, 90 employees",
                },
                {
                  quote: "Most tools give you a dashboard and call it insights. Pandora actually tells you what to do next — and shows you exactly why.",
                  initials: "VP",
                  name: "VP of Sales",
                  role: "B2B SaaS, 250 employees",
                },
              ].map((card, i) => (
                <Reveal key={i} delay={i * 0.1}>
                  <div style={{
                    background: t.surface,
                    border: `1px solid ${t.border}`,
                    borderRadius: 12,
                    padding: 28,
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                  }}>
                    <p style={{ fontSize: 14, color: t.textSec, lineHeight: 1.7, marginBottom: 20, fontStyle: "italic" }}>
                      "{card.quote}"
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: `linear-gradient(135deg, ${t.accent}, ${t.cyan})`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 700,
                        color: "white",
                        flexShrink: 0,
                        fontFamily: "'Outfit', sans-serif",
                      }}>
                        {card.initials}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{card.name}</div>
                        <div style={{ fontSize: 12, color: t.textMuted }}>{card.role}</div>
                      </div>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section style={{ padding: "80px 24px 100px", background: t.bg2, position: "relative" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 48 }}>
              <Badge>Design Partner Benefits</Badge>
              <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 700, marginTop: 16, marginBottom: 12, letterSpacing: "-0.03em", fontFamily: "'Outfit', sans-serif" }}>
                What you get as a founding partner
              </h2>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {[
                {
                  icon: "⚡",
                  iconBg: `rgba(99,102,241,0.12)`,
                  title: "First analysis in under 10 minutes",
                  body: "We connect to your CRM, run the full analysis, and walk you through what we found — hands-on, same session.",
                },
                {
                  icon: "🎯",
                  iconBg: `rgba(167,139,250,0.12)`,
                  title: "Direct line to the founder",
                  body: "Private Slack channel with Jeff. Your use case gets real attention — not a support ticket queue and a generic roadmap.",
                },
                {
                  icon: "🗺️",
                  iconBg: `rgba(52,211,153,0.12)`,
                  title: "Your input shapes the roadmap",
                  body: "Design partners don't just use the product — they define it. The features built in the next 90 days come directly from your feedback.",
                },
                {
                  icon: "🔒",
                  iconBg: `rgba(251,191,36,0.12)`,
                  title: "Founding partner pricing, locked in forever",
                  body: "Early partners get access at a rate that never increases — even as Pandora scales into a full RevOps platform.",
                },
              ].map((benefit, i) => (
                <Reveal key={i} delay={i * 0.08}>
                  <div
                    style={{
                      display: "flex",
                      gap: 16,
                      padding: 28,
                      background: t.surface,
                      border: `1px solid ${t.border}`,
                      borderRadius: 12,
                      transition: "border-color 0.3s ease, transform 0.2s ease",
                      cursor: "default",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "rgba(99,102,241,0.3)";
                      e.currentTarget.style.transform = "translateY(-2px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = t.border;
                      e.currentTarget.style.transform = "translateY(0)";
                    }}
                  >
                    <div style={{
                      flexShrink: 0,
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: benefit.iconBg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 20,
                    }}>
                      {benefit.icon}
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, fontFamily: "'Outfit', sans-serif" }}>
                        {benefit.title}
                      </div>
                      <p style={{ fontSize: 13.5, color: t.textSec, lineHeight: 1.6 }}>
                        {benefit.body}
                      </p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section
        id="waitlist"
        style={{
          padding: "100px 24px",
          background: t.bg,
          position: "relative",
          textAlign: "center",
        }}
      >
        <Orb color={t.accent} size="500px" top="-200px" left="50%" opacity={0.06} />
        <div style={{ maxWidth: 560, margin: "0 auto", position: "relative", zIndex: 1 }}>
          <Reveal>
            <h2 style={{
              fontSize: "clamp(28px, 4vw, 48px)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              fontFamily: "'Outfit', sans-serif",
              marginBottom: 16,
              lineHeight: 1.1,
            }}>
              Your pipeline has a story.<br />
              <span style={gradText}>Most teams never read it.</span>
            </h2>
            <p style={{ fontSize: 16, color: t.textSec, marginBottom: 36, lineHeight: 1.65, maxWidth: 480, margin: "0 auto 36px" }}>
              Pandora is a Revenue Intelligence solution — not just a dashboard.
              Connect your CRM in minutes. Get your first analysis before end of day.
              Direct founder access. Your use case shapes the product.
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <HubSpotForm />
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
                onMouseEnter={(e) => ((e.target as HTMLElement).style.color = t.text)}
                onMouseLeave={(e) => ((e.target as HTMLElement).style.color = t.textSec)}
              >
                Already have access? Sign in →
              </a>
            </div>
          </Reveal>
        </div>
      </section>

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
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <img src="/pandora-logo.png" alt="Pandora" style={{ width: 18, height: 18, borderRadius: 4 }} />
              <span style={{ fontSize: 14, fontWeight: 600, ...gradText }}>pandora</span>
            </div>
            <p style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.6, marginBottom: 16 }}>
              RevOps intelligence platform.
              <br />Built by a practitioner, for practitioners.
            </p>
            <span style={{ fontSize: 11, color: t.textMuted }}>© 2026 RevOps Impact</span>
          </div>

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
                onMouseEnter={(e) => ((e.target as HTMLElement).style.color = t.textSec)}
                onMouseLeave={(e) => ((e.target as HTMLElement).style.color = t.textMuted)}
              >
                {link.label}
              </a>
            ))}
          </div>

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
                onMouseEnter={(e) => ((e.target as HTMLElement).style.color = t.textSec)}
                onMouseLeave={(e) => ((e.target as HTMLElement).style.color = t.textMuted)}
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
