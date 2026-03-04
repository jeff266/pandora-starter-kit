import { useState } from "react";

const C = {
  bg: "#06080c",
  bgSidebar: "#0a0d14",
  surface: "#0f1219",
  surfaceRaised: "#141820",
  surfaceHover: "#1a1f2a",
  surfaceActive: "#1e2436",
  border: "#1a1f2b",
  borderLight: "#242b3a",
  text: "#e8ecf4",
  textSecondary: "#94a3b8",
  textMuted: "#5a6578",
  textDim: "#3a4252",
  accent: "#3b82f6",
  accentSoft: "rgba(59,130,246,0.12)",
  accentGlow: "rgba(59,130,246,0.25)",
  green: "#22c55e",
  greenSoft: "rgba(34,197,94,0.1)",
  greenBorder: "rgba(34,197,94,0.25)",
  yellow: "#eab308",
  yellowSoft: "rgba(234,179,8,0.1)",
  yellowBorder: "rgba(234,179,8,0.25)",
  red: "#ef4444",
  redSoft: "rgba(239,68,68,0.1)",
  redBorder: "rgba(239,68,68,0.25)",
  purple: "#a78bfa",
  purpleSoft: "rgba(167,139,250,0.1)",
  orange: "#f97316",
  orangeSoft: "rgba(249,115,22,0.1)",
  cyan: "#06b6d4",
  cyanSoft: "rgba(6,182,212,0.1)",
};

const font = "'IBM Plex Sans', -apple-system, sans-serif";
const mono = "'IBM Plex Mono', monospace";

const Icon = ({ d, size = 16, color = C.textMuted }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const PATTERN_META = {
  displacement_threat: { label: "Displacement Threat", color: C.red, bg: C.redSoft, border: C.redBorder, tip: "Actively replacing your product in existing accounts" },
  pricing_pressure:   { label: "Pricing Pressure",    color: C.orange, bg: C.orangeSoft, border: "rgba(249,115,22,0.25)", tip: "Driving discounting behavior and budget conversations" },
  feature_gap:        { label: "Feature Gap",         color: C.yellow, bg: C.yellowSoft, border: C.yellowBorder, tip: "Winning on specific capability your product lacks" },
  emerging_threat:    { label: "Emerging Threat",     color: C.purple, bg: C.purpleSoft, border: "rgba(167,139,250,0.25)", tip: "Appearing more frequently — watch for acceleration" },
  declining_threat:   { label: "Declining",           color: C.green, bg: C.greenSoft, border: C.greenBorder, tip: "Mention frequency and win-rate impact both decreasing" },
  segment_specific:   { label: "Segment-Specific",    color: C.cyan, bg: C.cyanSoft, border: "rgba(6,182,212,0.25)", tip: "Dominant in one ICP segment but not broadly threatening" },
};

const COMPETITORS = [
  { name: "Gong",       deals: 34, winRate: 38, baseline: 61, delta: -23, trend: "up",     pattern: "displacement_threat", mentions: "+18% MoM" },
  { name: "Salesloft",  deals: 28, winRate: 44, baseline: 61, delta: -17, trend: "stable", pattern: "pricing_pressure",    mentions: "stable" },
  { name: "Clari",      deals: 19, winRate: 52, baseline: 61, delta:  -9, trend: "up",     pattern: "emerging_threat",     mentions: "+31% MoM" },
  { name: "Chorus",     deals: 11, winRate: 63, baseline: 61, delta:  +2, trend: "down",   pattern: "declining_threat",    mentions: "-12% MoM" },
  { name: "Outreach",   deals:  9, winRate: 48, baseline: 61, delta: -13, trend: "stable", pattern: "feature_gap",         mentions: "stable" },
  { name: "ZoomInfo",   deals:  6, winRate: 71, baseline: 61, delta: +10, trend: "down",   pattern: "segment_specific",    mentions: "-8% MoM" },
];

const OPEN_DEALS = [
  { deal: "Meridian Health",    competitor: "Gong",      amount: 148000, stage: "Evaluation",  calls: 4, lastMention: "3d ago",  risk: "high" },
  { deal: "Foxridge Capital",   competitor: "Clari",     amount: 112000, stage: "Proposal",    calls: 2, lastMention: "1d ago",  risk: "high" },
  { deal: "Stackline Inc",      competitor: "Gong",      amount:  94000, stage: "Discovery",   calls: 3, lastMention: "5d ago",  risk: "high" },
  { deal: "Lumio Technologies", competitor: "Salesloft", amount:  87000, stage: "Negotiation", calls: 1, lastMention: "8d ago",  risk: "med" },
  { deal: "Vertex Partners",    competitor: "Clari",     amount:  76000, stage: "Evaluation",  calls: 2, lastMention: "2d ago",  risk: "high" },
  { deal: "Northgate SaaS",     competitor: "Outreach",  amount:  61000, stage: "Discovery",   calls: 1, lastMention: "11d ago", risk: "low" },
  { deal: "Brightfield Group",  competitor: "Salesloft", amount:  55000, stage: "Proposal",    calls: 2, lastMention: "4d ago",  risk: "med" },
];

const INTEL_FEED = [
  {
    competitor: "Gong",
    deal: "Meridian Health",
    date: "Mar 1, 2026",
    rep: "A. Torres",
    quote: "Their VP of Sales mentioned they're piloting Gong across the SDR team right now — said it came down to the coaching layer. They want to see if we do the same thing.",
    score: 94,
  },
  {
    competitor: "Clari",
    deal: "Foxridge Capital",
    date: "Feb 27, 2026",
    rep: "M. Chen",
    quote: "CFO pushed back on pricing — said Clari gave them a full revenue platform for the same cost. We need to show more than pipeline visibility if we're going to compete on value.",
    score: 88,
  },
  {
    competitor: "Gong",
    deal: "Stackline Inc",
    date: "Feb 25, 2026",
    rep: "J. Reyes",
    quote: "They've used Gong before at a previous company. The CRO said she'll need to justify switching — asked specifically about call recording and rep scorecards.",
    score: 81,
  },
  {
    competitor: "Salesloft",
    deal: "Lumio Technologies",
    date: "Feb 22, 2026",
    rep: "A. Torres",
    quote: "The ops lead brought up Salesloft's sequencing — they have a process built around it and would need to migrate. Said it's a non-trivial lift to move off.",
    score: 77,
  },
  {
    competitor: "Clari",
    deal: "Vertex Partners",
    date: "Feb 20, 2026",
    rep: "S. Nakamura",
    quote: "RevOps director said Clari is already in their shortlist. They ran a trial last year and liked the forecasting UI. We're being evaluated as a challenger.",
    score: 72,
  },
];

const SORT_OPTIONS = ["Deal Value", "Risk", "Last Mention"];

function PatternBadge({ pattern, showTooltip = true }) {
  const [hovered, setHovered] = useState(false);
  const meta = PATTERN_META[pattern] || { label: pattern, color: C.textMuted, bg: C.surface, border: C.border, tip: "" };
  return (
    <div style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      <span style={{
        fontSize: 11, fontWeight: 600, letterSpacing: "0.03em",
        color: meta.color, background: meta.bg,
        border: `1px solid ${meta.border}`,
        borderRadius: 4, padding: "2px 8px",
        fontFamily: font, whiteSpace: "nowrap",
      }}>{meta.label}</span>
      {showTooltip && hovered && meta.tip && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%",
          transform: "translateX(-50%)",
          background: C.surfaceRaised, border: `1px solid ${C.borderLight}`,
          borderRadius: 6, padding: "6px 10px",
          fontSize: 12, color: C.textSecondary, fontFamily: font,
          whiteSpace: "nowrap", zIndex: 100,
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          pointerEvents: "none",
        }}>{meta.tip}</div>
      )}
    </div>
  );
}

function TrendArrow({ trend }) {
  if (trend === "up")     return <span style={{ color: C.red,   fontSize: 14 }}>↑</span>;
  if (trend === "down")   return <span style={{ color: C.green, fontSize: 14 }}>↓</span>;
  return <span style={{ color: C.textMuted, fontSize: 14 }}>→</span>;
}

function Delta({ value }) {
  const color = value > 0 ? C.green : value < 0 ? C.red : C.textMuted;
  const sign  = value > 0 ? "+" : "";
  return <span style={{ color, fontFamily: mono, fontSize: 13, fontWeight: 600 }}>{sign}{value}pp</span>;
}

function RiskDot({ risk }) {
  const color = risk === "high" ? C.red : risk === "med" ? C.yellow : C.green;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 12, color, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, boxShadow: `0 0 5px ${color}88` }} />
      {risk}
    </span>
  );
}

function StatCard({ label, value, sub, valueColor, accent }) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: "18px 22px",
      borderTop: accent ? `2px solid ${accent}` : undefined,
    }}>
      <div style={{ fontSize: 12, color: C.textMuted, fontFamily: font, fontWeight: 500, marginBottom: 6, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: valueColor || C.text, fontFamily: font, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.textMuted, fontFamily: font, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

export default function CompetitiveIntelligencePage() {
  const [sortBy, setSortBy] = useState("Deal Value");
  const [selectedCompetitor, setSelectedCompetitor] = useState(null);

  const totalExposure = OPEN_DEALS.reduce((s, d) => s + d.amount, 0);
  const highRisk = OPEN_DEALS.filter(d => d.risk === "high").reduce((s, d) => s + d.amount, 0);

  const filteredDeals = selectedCompetitor
    ? OPEN_DEALS.filter(d => d.competitor === selectedCompetitor)
    : OPEN_DEALS;

  const filteredFeed = selectedCompetitor
    ? INTEL_FEED.filter(d => d.competitor === selectedCompetitor)
    : INTEL_FEED;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: font, color: C.text, padding: "28px 32px" }}>

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Icon d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" size={15} color={C.purple} />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: C.text }}>Competitive Intelligence</h1>
          </div>
          <div style={{ fontSize: 13, color: C.textMuted }}>
            Last analyzed <strong style={{ color: C.textSecondary }}>Mar 1, 2026</strong> · 90-day trailing window · 6 competitors tracked
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {selectedCompetitor && (
            <button onClick={() => setSelectedCompetitor(null)} style={{
              background: C.surfaceRaised, border: `1px solid ${C.borderLight}`,
              color: C.textSecondary, fontSize: 13, padding: "7px 14px",
              borderRadius: 7, cursor: "pointer", fontFamily: font,
            }}>
              Clear filter
            </button>
          )}
          <div style={{
            background: C.surfaceRaised, border: `1px solid ${C.borderLight}`,
            borderRadius: 7, padding: "7px 13px",
            fontSize: 12, color: C.textMuted, display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green, boxShadow: `0 0 5px ${C.green}88` }} />
            Auto-runs 1st of each month
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "flex", gap: 14, marginBottom: 28 }}>
        <StatCard label="Baseline win rate" value="61%" sub="Deals with no competitors" accent={C.green} />
        <StatCard label="Open pipeline at risk" value={`$${(totalExposure/1000).toFixed(0)}K`} sub={`$${(highRisk/1000).toFixed(0)}K flagged high-risk`} valueColor={C.red} accent={C.red} />
        <StatCard label="Hardest to beat" value="Gong" sub="−23pp vs. baseline" valueColor={C.red} accent={C.purple} />
        <StatCard label="Competitor mentions" value="+22%" sub="vs. prior 90-day period" valueColor={C.orange} accent={C.orange} />
      </div>

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>

        {/* Open deal exposure */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", gridColumn: "1 / -1" }}>
          <div style={{ padding: "18px 22px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 2 }}>Open Deal Exposure</div>
              <div style={{ fontSize: 12, color: C.textMuted }}>
                {filteredDeals.length} open deals with competitor mentions · sorted by {sortBy.toLowerCase()}
                {selectedCompetitor && <span style={{ color: C.purple }}> · filtered to {selectedCompetitor}</span>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {SORT_OPTIONS.map(s => (
                <button key={s} onClick={() => setSortBy(s)} style={{
                  background: sortBy === s ? C.accentSoft : "transparent",
                  border: `1px solid ${sortBy === s ? C.accent : C.border}`,
                  color: sortBy === s ? C.accent : C.textMuted,
                  fontSize: 12, padding: "5px 11px", borderRadius: 6,
                  cursor: "pointer", fontFamily: font,
                }}>{s}</button>
              ))}
            </div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Deal", "Competitor", "Amount", "Stage", "Calls w/ Mention", "Last Mention", "Risk"].map(h => (
                  <th key={h} style={{ padding: "8px 22px", textAlign: "left", fontSize: 11, fontWeight: 600, color: C.textMuted, letterSpacing: "0.06em", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredDeals.map((d, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, transition: "background 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.background = C.surfaceHover}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "11px 22px", fontSize: 13, fontWeight: 500, color: C.text }}>{d.deal}</td>
                  <td style={{ padding: "11px 22px" }}>
                    <button onClick={() => setSelectedCompetitor(d.competitor === selectedCompetitor ? null : d.competitor)}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: font }}>
                      <span style={{ fontSize: 13, color: C.accent, fontWeight: 600 }}>{d.competitor}</span>
                    </button>
                  </td>
                  <td style={{ padding: "11px 22px", fontSize: 13, fontFamily: mono, color: C.text, fontWeight: 600 }}>${(d.amount/1000).toFixed(0)}K</td>
                  <td style={{ padding: "11px 22px" }}>
                    <span style={{ fontSize: 12, color: C.textSecondary, background: C.surfaceRaised, border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 8px" }}>{d.stage}</span>
                  </td>
                  <td style={{ padding: "11px 22px", fontSize: 13, fontFamily: mono, color: C.textSecondary }}>{d.calls}</td>
                  <td style={{ padding: "11px 22px", fontSize: 13, color: C.textMuted }}>{d.lastMention}</td>
                  <td style={{ padding: "11px 22px" }}><RiskDot risk={d.risk} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Competitor leaderboard */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "18px 22px 0" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 2 }}>Competitor Leaderboard</div>
            <div style={{ fontSize: 12, color: C.textMuted }}>Win rate vs. your {" "}
              <span style={{ color: C.green, fontWeight: 600 }}>61% baseline</span>
              {" "}· click to filter
            </div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Competitor", "Deals", "Win Rate", "vs. Baseline", "Trend", "Pattern"].map(h => (
                  <th key={h} style={{ padding: "8px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: C.textMuted, letterSpacing: "0.06em", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPETITORS.map((c, i) => (
                <tr key={i}
                  onClick={() => setSelectedCompetitor(c.name === selectedCompetitor ? null : c.name)}
                  style={{
                    borderBottom: `1px solid ${C.border}`, cursor: "pointer",
                    background: selectedCompetitor === c.name ? C.surfaceActive : "transparent",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => { if (selectedCompetitor !== c.name) e.currentTarget.style.background = C.surfaceHover; }}
                  onMouseLeave={e => { if (selectedCompetitor !== c.name) e.currentTarget.style.background = "transparent"; }}>
                  <td style={{ padding: "11px 16px", fontSize: 13, fontWeight: 600, color: C.text }}>{c.name}</td>
                  <td style={{ padding: "11px 16px", fontSize: 13, fontFamily: mono, color: C.textSecondary }}>{c.deals}</td>
                  <td style={{ padding: "11px 16px", fontSize: 13, fontFamily: mono, fontWeight: 600, color: c.winRate < 50 ? C.red : C.green }}>{c.winRate}%</td>
                  <td style={{ padding: "11px 16px" }}><Delta value={c.delta} /></td>
                  <td style={{ padding: "11px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <TrendArrow trend={c.trend} />
                      <span style={{ fontSize: 11, color: C.textMuted, fontFamily: mono }}>{c.mentions}</span>
                    </div>
                  </td>
                  <td style={{ padding: "11px 16px" }}><PatternBadge pattern={c.pattern} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Field intel feed */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "18px 22px 16px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 2 }}>Field Intel Feed</div>
            <div style={{ fontSize: 12, color: C.textMuted }}>
              Raw quotes from call transcripts · ranked by confidence
              {selectedCompetitor && <span style={{ color: C.purple }}> · {selectedCompetitor} only</span>}
            </div>
          </div>
          <div style={{ padding: "0 22px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
            {filteredFeed.map((item, i) => {
              const meta = PATTERN_META;
              const compData = COMPETITORS.find(c => c.name === item.competitor);
              const pMeta = compData ? PATTERN_META[compData.pattern] : null;
              return (
                <div key={i} style={{
                  background: C.surfaceRaised, border: `1px solid ${C.borderLight}`,
                  borderRadius: 9, padding: "14px 16px",
                  borderLeft: pMeta ? `3px solid ${pMeta.color}` : `3px solid ${C.accent}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: pMeta?.color || C.accent }}>{item.competitor}</span>
                    <span style={{ fontSize: 11, color: C.textMuted }}>→</span>
                    <span style={{ fontSize: 12, color: C.textSecondary, fontWeight: 500 }}>{item.deal}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: C.textMuted }}>{item.date} · {item.rep}</span>
                    <span style={{
                      fontSize: 11, fontFamily: mono, fontWeight: 700,
                      color: item.score >= 90 ? C.green : item.score >= 75 ? C.yellow : C.textMuted,
                      background: C.surface, border: `1px solid ${C.border}`,
                      borderRadius: 4, padding: "1px 7px",
                    }}>{item.score}</span>
                  </div>
                  <p style={{
                    margin: 0, fontSize: 13, lineHeight: 1.55,
                    color: C.textSecondary, fontStyle: "italic",
                  }}>"{item.quote}"</p>
                </div>
              );
            })}
            {filteredFeed.length === 0 && (
              <div style={{ textAlign: "center", color: C.textMuted, fontSize: 13, padding: "32px 0" }}>
                No intel found for {selectedCompetitor}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 22px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 600, marginRight: 8 }}>PATTERN LEGEND</span>
        {Object.entries(PATTERN_META).map(([key, meta]) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              fontSize: 11, fontWeight: 600, color: meta.color,
              background: meta.bg, border: `1px solid ${meta.border}`,
              borderRadius: 4, padding: "2px 8px", fontFamily: font,
            }}>{meta.label}</span>
            <span style={{ fontSize: 11, color: C.textMuted }}>{meta.tip}</span>
            <span style={{ color: C.border, marginLeft: 4 }}>·</span>
          </div>
        ))}
      </div>
    </div>
  );
}
