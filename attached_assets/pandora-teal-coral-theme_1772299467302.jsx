import { useState } from "react";

/*
  Design thesis — riffing on @thalion_pb's dark mode palette principle:
  
  1. TWO distinct palettes, not one palette inverted
  2. Dark mode: desaturated teal/seafoam + muted coral on deep charcoal
  3. Light mode: richer versions of same hues, adjusted for white-surface contrast
  4. Signal colors (health A/B/C, days) follow the same desaturation rule
  5. Sidebar anchored dark in both modes (teal-black)
*/

const deals = [
  { name: "Ineos | Multisite Strateg...", amount: "$3.50M", stage: "00 - Target", stageHue: "teal", owner: "susana.hite", closeDate: "Aug 22, 2027", health: "B", healthHue: "blue", days: 377, daysLevel: "danger", calls: "No calls" },
  { name: "BAZAN Next Unit", amount: "$2.00M", stage: "04 - Proposa...", stageHue: "purple", owner: "adel.srhir", closeDate: "Jun 17, 2026", health: "B", healthHue: "blue", days: 308, daysLevel: "danger", calls: "No calls" },
  { name: "Eagle Materials - Enterp...", amount: "$1.71M", stage: "04 - Proposa...", stageHue: "purple", owner: "ronak.patel", closeDate: "Jun 29, 2026", health: "A", healthHue: "green", days: 33, daysLevel: "warn", calls: "No calls" },
  { name: "RENEWAL - Delek EDR F...", amount: "$1.48M", stage: "11 - Expansi...", stageHue: "indigo", owner: "steve.beitz", closeDate: "Dec 30, 2026", health: "B", healthHue: "blue", days: 42, daysLevel: "warn", calls: "No calls" },
  { name: "Chevron Phillips - Enterp...", amount: "$1.35M", stage: "02 - Qualify", stageHue: "cyan", owner: "ronak.patel", closeDate: "Sep 15, 2026", health: "C", healthHue: "amber", days: 156, daysLevel: "danger", calls: "No calls" },
];

const navGroups = [
  { section: null, items: [
    { icon: "grid", label: "All Clients" },
    { icon: "target", label: "Command Center" },
  ]},
  { section: "PIPELINE", items: [
    { icon: "diamond", label: "Deals", active: true },
    { icon: "building", label: "Accounts" },
    { icon: "message", label: "Conversations" },
  ]},
  { section: "INTELLIGENCE", items: [
    { icon: "user", label: "ICP Profile" },
    { icon: "play", label: "Stage Velocity" },
    { icon: "bot", label: "Agents" },
    { icon: "gear", label: "Skills", badge: 27 },
    { icon: "tool", label: "Tools" },
  ]},
  { section: "OPERATIONS", items: [
    { icon: "crosshair", label: "Targets" },
  ]},
];

/* ─── Semantic color maps per mode ─── */
const semanticDark = {
  teal:   { bg: "rgba(72,175,155,0.10)", border: "rgba(72,175,155,0.22)", text: "#5bbfaa" },
  purple: { bg: "rgba(160,130,210,0.10)", border: "rgba(160,130,210,0.22)", text: "#a88fd4" },
  indigo: { bg: "rgba(120,130,200,0.10)", border: "rgba(120,130,200,0.22)", text: "#8a94cc" },
  cyan:   { bg: "rgba(80,180,190,0.10)", border: "rgba(80,180,190,0.22)", text: "#5cb8bf" },
  green:  { bg: "rgba(72,190,130,0.10)", border: "rgba(72,190,130,0.25)", text: "#5cc09a" },
  blue:   { bg: "rgba(90,150,210,0.10)", border: "rgba(90,150,210,0.25)", text: "#6aaddb" },
  amber:  { bg: "rgba(210,170,80,0.10)", border: "rgba(210,170,80,0.25)", text: "#c4a854" },
};
const semanticLight = {
  teal:   { bg: "rgba(18,140,115,0.08)", border: "rgba(18,140,115,0.20)", text: "#0f7a63" },
  purple: { bg: "rgba(120,80,180,0.08)", border: "rgba(120,80,180,0.18)", text: "#7040b0" },
  indigo: { bg: "rgba(80,80,170,0.08)", border: "rgba(80,80,170,0.18)", text: "#4a48a8" },
  cyan:   { bg: "rgba(10,140,150,0.08)", border: "rgba(10,140,150,0.18)", text: "#0a7f88" },
  green:  { bg: "rgba(20,150,90,0.08)", border: "rgba(20,150,90,0.20)", text: "#128a55" },
  blue:   { bg: "rgba(40,110,180,0.08)", border: "rgba(40,110,180,0.20)", text: "#2060aa" },
  amber:  { bg: "rgba(180,130,20,0.08)", border: "rgba(180,130,20,0.20)", text: "#9a7014" },
};

const themes = {
  dark: {
    id: "dark",
    label: "Dark",
    semantic: semanticDark,
    // Surfaces — warm charcoal with faint teal undertone
    pageBg: "#0b1014",
    surfaceBg: "#111920",
    raisedBg: "#16202a",
    topBarBg: "#0e141a",
    // Sidebar — deep teal-black
    sidebarBg: "#0a1018",
    sidebarBorder: "#1a2a35",
    sidebarSection: "#4a6070",
    sidebarText: "#6a8898",
    sidebarHover: "#142028",
    sidebarActiveText: "#48af9b",
    sidebarActiveBg: "#142028",
    sidebarAccentBar: "#48af9b",
    // Content
    primaryText: "#e0e8ee",
    secondaryText: "#8a9caa",
    mutedText: "#506070",
    border: "#1c2c38",
    // Accent — desaturated teal (primary), muted coral (secondary)
    accent: "#48af9b",
    accentHover: "#5cc4ae",
    accentSubtle: "rgba(72,175,155,0.08)",
    coral: "#c8786a",
    coralSubtle: "rgba(200,120,106,0.10)",
    // Inputs
    inputBg: "#16202a",
    selectBg: "#16202a",
    selectBorder: "#1c2c38",
    hoverRow: "rgba(72,175,155,0.04)",
    // Banners
    bannerBg: "rgba(72,175,155,0.05)",
    bannerBorder: "rgba(72,175,155,0.12)",
    bannerText: "#8a9caa",
    // Table
    tableHeaderText: "#506070",
    cardShadow: "0 1px 4px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.02)",
    cardBorder: "1px solid #1c2c38",
    // Signal
    daysRed: "#d46a5a",
    daysAmber: "#c4a854",
    // Typography
    headingFont: "'Outfit', sans-serif",
    bodyFont: "'Outfit', sans-serif",
    monoFont: "'JetBrains Mono', monospace",
    noiseOpacity: 0.02,
  },
  light: {
    id: "light",
    label: "Light",
    semantic: semanticLight,
    pageBg: "#f0f4f3",
    surfaceBg: "#ffffff",
    raisedBg: "#f7f9f8",
    topBarBg: "#ffffff",
    sidebarBg: "#0f1a22",
    sidebarBorder: "#1a2a35",
    sidebarSection: "#4a6070",
    sidebarText: "#6a8898",
    sidebarHover: "#182830",
    sidebarActiveText: "#5cc4ae",
    sidebarActiveBg: "#182830",
    sidebarAccentBar: "#48af9b",
    primaryText: "#0f1f2a",
    secondaryText: "#4a6070",
    mutedText: "#8a9caa",
    border: "#dce4e2",
    accent: "#1a8a72",
    accentHover: "#147a64",
    accentSubtle: "rgba(26,138,114,0.06)",
    coral: "#c0604e",
    coralSubtle: "rgba(192,96,78,0.07)",
    inputBg: "#f0f4f3",
    selectBg: "#ffffff",
    selectBorder: "#dce4e2",
    hoverRow: "#f7f9f8",
    bannerBg: "rgba(26,138,114,0.04)",
    bannerBorder: "rgba(26,138,114,0.14)",
    bannerText: "#4a6070",
    tableHeaderText: "#7a8e98",
    cardShadow: "0 1px 3px rgba(15,31,42,0.06), 0 1px 2px rgba(15,31,42,0.03)",
    cardBorder: "1px solid #dce4e2",
    daysRed: "#c0503a",
    daysAmber: "#9a7814",
    headingFont: "'Outfit', sans-serif",
    bodyFont: "'Outfit', sans-serif",
    monoFont: "'JetBrains Mono', monospace",
    noiseOpacity: 0.012,
  },
};

function Ic({ type, size = 16 }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", fill: "none", strokeLinecap: "round", strokeLinejoin: "round" };
  const d = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
    diamond: <path d="M12 2l10 10-10 10L2 12z"/>,
    building: <><path d="M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18"/><path d="M6 12H4a2 2 0 00-2 2v6a2 2 0 002 2h2"/><path d="M18 9h2a2 2 0 012 2v9a2 2 0 01-2 2h-2"/></>,
    message: <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>,
    user: <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    play: <polygon points="5 3 19 12 5 21 5 3"/>,
    bot: <><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.5" fill="none"/></>,
    gear: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></>,
    tool: <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>,
    crosshair: <><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></>,
    bell: <><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></>,
    search: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    globe: <><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></>,
    chevron: <polyline points="6 9 12 15 18 9"/>,
  };
  return <svg {...p}>{d[type]}</svg>;
}

export default function PandoraThemeV2() {
  const [mode, setMode] = useState("dark");
  const t = themes[mode];
  const isDark = mode === "dark";

  return (
    <div style={{
      display: "flex", height: "100vh",
      fontFamily: t.bodyFont, background: t.pageBg, color: t.primaryText,
      fontSize: 14, transition: "background 0.45s ease, color 0.35s ease",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Noise overlay */}
      {t.noiseOpacity > 0 && <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999, opacity: t.noiseOpacity,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        mixBlendMode: "overlay",
      }} />}

      {/* ── Sidebar — always dark, teal-black ── */}
      <aside style={{
        width: 252, background: t.sidebarBg, borderRight: `1px solid ${t.sidebarBorder}`,
        display: "flex", flexDirection: "column", flexShrink: 0, overflow: "auto",
        transition: "background 0.4s ease",
      }}>
        {/* Workspace */}
        <div style={{ padding: "15px 14px 13px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${t.sidebarBorder}` }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8,
            background: "linear-gradient(135deg, #48af9b 0%, #3a9585 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#0a1018", fontWeight: 700, fontSize: 15, fontFamily: t.headingFont,
          }}>I</div>
          <div style={{ flex: 1 }}>
            <div style={{ color: "#d8e4ea", fontWeight: 600, fontSize: 13.5, fontFamily: t.headingFont }}>Imubit</div>
            <div style={{ color: t.sidebarSection, fontSize: 11.5 }}>Admin</div>
          </div>
          <span style={{ color: t.sidebarSection, cursor: "pointer" }}><Ic type="chevron" size={14} /></span>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "6px 7px" }}>
          {navGroups.map((g, gi) => (
            <div key={gi}>
              {g.section && (
                <div style={{
                  padding: "18px 11px 5px", fontSize: 10, fontWeight: 600,
                  letterSpacing: "0.1em", color: t.sidebarSection, fontFamily: t.bodyFont,
                }}>{g.section}</div>
              )}
              {g.items.map((item, ii) => (
                <div key={ii} style={{
                  padding: "7px 11px", borderRadius: 6, display: "flex", alignItems: "center", gap: 10,
                  cursor: "pointer",
                  color: item.active ? t.sidebarActiveText : t.sidebarText,
                  background: item.active ? t.sidebarActiveBg : "transparent",
                  fontSize: 13, fontWeight: item.active ? 500 : 400,
                  borderLeft: item.active ? `2px solid ${t.sidebarAccentBar}` : "2px solid transparent",
                  transition: "all 0.15s ease",
                }}>
                  <Ic type={item.icon} size={15} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.badge && (
                    <span style={{
                      background: "rgba(72,175,155,0.12)", color: "#5bbfaa",
                      fontSize: 11, fontWeight: 500, padding: "1px 7px", borderRadius: 10,
                    }}>{item.badge}</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </nav>

        <div style={{ padding: "12px 16px", borderTop: `1px solid ${t.sidebarBorder}`, color: t.sidebarSection }}>
          <Ic type="bell" size={18} />
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main style={{ flex: 1, overflow: "auto", background: t.pageBg, transition: "background 0.4s ease" }}>
        {/* Top bar */}
        <header style={{
          padding: "13px 26px", display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: `1px solid ${t.border}`, background: t.topBarBg,
          boxShadow: isDark ? "none" : "0 1px 2px rgba(15,31,42,0.04)",
          transition: "all 0.35s ease",
        }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, fontFamily: t.headingFont, letterSpacing: "-0.01em" }}>Open Deals</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Mode toggle */}
            <div style={{
              display: "flex", borderRadius: 8, overflow: "hidden",
              border: `1px solid ${t.border}`, background: t.inputBg,
            }}>
              {["dark", "light"].map(m => (
                <button key={m} onClick={() => setMode(m)} style={{
                  padding: "5px 14px", fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer",
                  fontFamily: t.bodyFont, textTransform: "capitalize",
                  background: mode === m ? t.accent : "transparent",
                  color: mode === m ? (isDark ? "#0b1014" : "#ffffff") : t.mutedText,
                  transition: "all 0.2s ease",
                }}>{m}</button>
              ))}
            </div>
            <div style={{ width: 1, height: 18, background: t.border }} />
            <button style={{
              display: "flex", alignItems: "center", gap: 5,
              background: t.inputBg, border: `1px solid ${t.border}`,
              borderRadius: 7, padding: "5px 11px", color: t.primaryText,
              fontSize: 12.5, fontWeight: 500, cursor: "pointer", fontFamily: t.bodyFont,
            }}>
              <Ic type="globe" size={13} /> All Data <Ic type="chevron" size={11} />
            </button>
            <span style={{ color: t.mutedText, fontSize: 12 }}>Updated just now</span>
          </div>
        </header>

        <div style={{ padding: "20px 26px", maxWidth: 1240 }}>
          {/* Quota banner */}
          <div style={{
            padding: "12px 18px", borderRadius: 8,
            background: t.bannerBg, border: `1px solid ${t.bannerBorder}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 16, transition: "all 0.3s ease",
          }}>
            <span style={{ color: t.bannerText, fontSize: 13 }}>No quotas configured yet. Set up quotas to unlock attainment tracking and gap analysis.</span>
            <button style={{
              padding: "6px 16px", borderRadius: 6,
              border: `1px solid ${t.accent}`, background: "transparent",
              color: t.accent, fontWeight: 500, fontSize: 12.5, cursor: "pointer",
              fontFamily: t.bodyFont, whiteSpace: "nowrap",
            }}>Set Up Quotas</button>
          </div>

          {/* Deals header */}
          <div style={{
            padding: "18px 20px", borderRadius: 8,
            background: t.surfaceBg, border: t.cardBorder,
            marginBottom: 16, boxShadow: t.cardShadow,
            transition: "all 0.3s ease",
          }}>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, fontFamily: t.headingFont, letterSpacing: "-0.01em" }}>Deals</h2>
            <p style={{ margin: "4px 0 0", color: t.secondaryText, fontSize: 13 }}>
              Showing 236 of 627 deals · <span style={{ color: t.accent, fontWeight: 600 }}>$123.31M</span> pipeline
            </p>
          </div>

          {/* Filters + Table */}
          <div style={{
            padding: "14px 18px", borderRadius: 8,
            background: t.surfaceBg, border: t.cardBorder,
            boxShadow: t.cardShadow, transition: "all 0.3s ease",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{
                flex: "0 0 185px", display: "flex", alignItems: "center", gap: 7,
                background: t.inputBg, border: `1px solid ${t.border}`,
                borderRadius: 6, padding: "6px 10px",
              }}>
                <span style={{ color: t.mutedText }}><Ic type="search" size={14} /></span>
                <span style={{ color: t.mutedText, fontSize: 12.5 }}>Search deals...</span>
              </div>
              <Lbl t={t}>Pipeline:</Lbl>
              <Sel t={t}>New Business (605)</Sel>
              <Lbl t={t}>Stage:</Lbl>
              <Sel t={t}>All</Sel>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
              <Lbl t={t}>Owner:</Lbl>
              <Sel t={t}>All</Sel>
              <Lbl t={t}>Health:</Lbl>
              <Sel t={t} compact>All</Sel>
              <Lbl t={t}>Status:</Lbl>
              <Sel t={t}>Open</Sel>
              <span style={{ color: t.coral, fontSize: 12.5, cursor: "pointer", fontWeight: 500 }}>Clear filters</span>
            </div>

            {/* Table */}
            <div style={{ marginTop: 16, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${t.border}` }}>
                    {["DEAL NAME", "AMOUNT ▼", "STAGE", "OWNER", "CLOSE DATE", "HEALTH", "DAYS", "LAST CALL SIGNALS"].map((h, i) => (
                      <th key={i} style={{
                        textAlign: "left", padding: "8px 10px", fontSize: 10,
                        fontWeight: 600, letterSpacing: "0.08em", color: t.tableHeaderText,
                        whiteSpace: "nowrap", fontFamily: t.bodyFont,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deals.map((d, i) => {
                    const stageSem = t.semantic[d.stageHue];
                    const healthSem = t.semantic[d.healthHue];
                    return (
                      <tr key={i}
                        style={{ borderBottom: `1px solid ${t.border}`, cursor: "pointer", transition: "background 0.12s" }}
                        onMouseEnter={e => e.currentTarget.style.background = t.hoverRow}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <td style={{ padding: "11px 10px", color: t.accent, fontWeight: 500, fontSize: 13, whiteSpace: "nowrap" }}>{d.name}</td>
                        <td style={{ padding: "11px 10px", fontFamily: t.monoFont, fontWeight: 500, fontSize: 12.5, whiteSpace: "nowrap" }}>{d.amount}</td>
                        <td style={{ padding: "11px 10px" }}>
                          <span style={{
                            display: "inline-block", padding: "2px 8px", borderRadius: 5, fontSize: 11,
                            fontWeight: 500, whiteSpace: "nowrap",
                            background: stageSem.bg, color: stageSem.text, border: `1px solid ${stageSem.border}`,
                          }}>{d.stage}</span>
                        </td>
                        <td style={{ padding: "11px 10px", color: t.secondaryText, fontSize: 12.5 }}>{d.owner}</td>
                        <td style={{ padding: "11px 10px", color: t.secondaryText, fontSize: 12.5, whiteSpace: "nowrap" }}>{d.closeDate}</td>
                        <td style={{ padding: "11px 10px", textAlign: "center" }}>
                          <span style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            width: 24, height: 24, borderRadius: 5,
                            background: healthSem.bg, color: healthSem.text,
                            fontWeight: 600, fontSize: 11, border: `1px solid ${healthSem.border}`,
                          }}>{d.health}</span>
                        </td>
                        <td style={{
                          padding: "11px 10px", textAlign: "center", fontWeight: 600, fontSize: 12.5,
                          fontFamily: t.monoFont,
                          color: d.daysLevel === "danger" ? t.daysRed : t.daysAmber,
                        }}>{d.days}</td>
                        <td style={{ padding: "11px 10px", color: t.mutedText, fontSize: 12.5 }}>{d.calls}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Color palette reference */}
          <div style={{
            marginTop: 22, padding: "18px 20px", borderRadius: 8,
            background: t.surfaceBg, border: t.cardBorder,
            boxShadow: t.cardShadow, transition: "all 0.3s ease",
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, fontFamily: t.headingFont, color: t.primaryText }}>
              Palette Reference — {isDark ? "Dark" : "Light"} Mode
            </div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <PaletteGroup label="Surfaces" t={t} colors={[
                { c: t.pageBg, n: "Page" },
                { c: t.surfaceBg, n: "Card" },
                { c: t.raisedBg, n: "Raised" },
                { c: t.sidebarBg, n: "Sidebar" },
              ]} />
              <PaletteGroup label="Text" t={t} colors={[
                { c: t.primaryText, n: "Primary" },
                { c: t.secondaryText, n: "Secondary" },
                { c: t.mutedText, n: "Muted" },
                { c: t.tableHeaderText, n: "Header" },
              ]} />
              <PaletteGroup label="Accents" t={t} colors={[
                { c: t.accent, n: "Teal" },
                { c: t.coral, n: "Coral" },
                { c: t.daysRed, n: "Danger" },
                { c: t.daysAmber, n: "Warn" },
              ]} />
              <PaletteGroup label="Semantic (desaturated)" t={t} colors={[
                { c: t.semantic.teal.text, n: "Teal" },
                { c: t.semantic.purple.text, n: "Purple" },
                { c: t.semantic.green.text, n: "Green" },
                { c: t.semantic.blue.text, n: "Blue" },
              ]} />
            </div>
            <div style={{ marginTop: 16, fontSize: 12, lineHeight: 1.8, color: t.secondaryText }}>
              {isDark ? (
                <>
                  <strong style={{ color: t.primaryText }}>Desaturated dark mode</strong> — all semantic colors (stage pills, health badges) use reduced saturation per the @thalion_pb principle. Teal accent at ~55% saturation instead of vivid.{" "}
                  <strong style={{ color: t.primaryText }}>Warm charcoal base</strong> — faint teal undertone across all surfaces (#0b1014 → #111920 → #16202a).{" "}
                  <strong style={{ color: t.primaryText }}>Coral as secondary</strong> — "Clear filters" and destructive actions use muted coral, not harsh red.{" "}
                  <strong style={{ color: t.primaryText }}>Outfit + JetBrains Mono</strong> — geometric, modern, distinctive. Neither in the "AI default" font family.
                </>
              ) : (
                <>
                  <strong style={{ color: t.primaryText }}>Richer light mode</strong> — same hue families but deeper saturation to maintain contrast on white. Teal shifts from #48af9b → #1a8a72.{" "}
                  <strong style={{ color: t.primaryText }}>Warm neutral base</strong> — #f0f4f3 has a green-gray warmth instead of cold slate. Cards are true white with teal-tinted shadows.{" "}
                  <strong style={{ color: t.primaryText }}>Sidebar stays dark</strong> — the teal-black sidebar anchors both modes, creating instant brand recognition.{" "}
                  <strong style={{ color: t.primaryText }}>Semantic colors deepened</strong> — every pill/badge color independently tuned for WCAG AA contrast on white.
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Lbl({ t, children }) {
  return <span style={{ color: t.mutedText, fontSize: 12.5 }}>{children}</span>;
}
function Sel({ t, children, compact }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: t.selectBg, border: `1px solid ${t.selectBorder}`,
      borderRadius: 6, padding: compact ? "4px 8px" : "5px 10px",
      fontSize: 12.5, fontWeight: 500, color: t.primaryText, cursor: "pointer",
    }}>
      {children} <Ic type="chevron" size={11} />
    </div>
  );
}
function PaletteGroup({ label, t, colors }) {
  return (
    <div style={{ minWidth: 140 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", color: t.mutedText, marginBottom: 8 }}>{label.toUpperCase()}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {colors.map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 5, background: c.c,
              border: `1px solid ${t.border}`,
              boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
            }} />
            <div>
              <span style={{ fontSize: 11.5, color: t.secondaryText }}>{c.n}</span>
              <span style={{ fontSize: 10, color: t.mutedText, marginLeft: 6, fontFamily: t.monoFont }}>{c.c}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
