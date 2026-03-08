import { useState, useRef, useEffect } from "react";

const COLORS = {
  bg: "#0A0F1E",
  surface: "#0F1629",
  card: "#141D35",
  border: "#1E2D50",
  teal: "#2DD4BF",
  tealDim: "#0D9488",
  tealFaint: "#0D948820",
  coral: "#FB7185",
  coralDim: "#E11D48",
  coralFaint: "#FB718520",
  amber: "#FBBF24",
  amberFaint: "#FBBF2420",
  purple: "#A78BFA",
  purpleFaint: "#A78BFA20",
  text: "#E2E8F0",
  textDim: "#94A3B8",
  textFaint: "#475569",
  green: "#34D399",
  greenFaint: "#34D39920",
};

// ─── SANKEY ──────────────────────────────────────────────────────────────────

function SankeyDiagram() {
  const stages = [
    { id: "discovery", label: "Discovery", x: 40, deals: 52, value: 2140000, color: COLORS.purple },
    { id: "qualification", label: "Qualification", x: 220, deals: 38, value: 1820000, color: COLORS.teal },
    { id: "proposal", label: "Proposal", x: 400, deals: 24, value: 1230000, color: COLORS.teal },
    { id: "negotiation", label: "Negotiation", x: 580, deals: 15, value: 890000, color: COLORS.amber },
    { id: "closed_won", label: "Closed Won", x: 760, deals: 9, value: 520000, color: COLORS.green },
  ];
  const lostStages = [
    { fromId: "discovery", deals: 8, value: 240000, yOffset: 0.15 },
    { fromId: "qualification", deals: 10, value: 380000, yOffset: 0.2 },
    { fromId: "proposal", deals: 7, value: 270000, yOffset: 0.2 },
    { fromId: "negotiation", deals: 4, value: 195000, yOffset: 0.2 },
  ];

  const HEIGHT = 320;
  const NODE_W = 14;
  const maxValue = 2140000;

  const nodeHeight = (v) => Math.max(20, (v / maxValue) * 200);

  const nodeY = (stage) => {
    const h = nodeHeight(stage.value);
    return HEIGHT / 2 - h / 2 - 20;
  };

  const fmt = (v) =>
    v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : `$${(v / 1000).toFixed(0)}K`;

  const [hovered, setHovered] = useState(null);

  // Draw flow between stages
  const flows = [];
  for (let i = 0; i < stages.length - 1; i++) {
    const from = stages[i];
    const to = stages[i + 1];
    const fh = nodeHeight(from.value);
    const th = nodeHeight(to.value);
    const fy = nodeY(from);
    const ty = nodeY(to);
    const x1 = from.x + NODE_W;
    const x2 = to.x;
    const cx = (x1 + x2) / 2;
    flows.push({ from, to, x1, x2, cx, fy, ty, fh, th, key: `${from.id}-${to.id}` });
  }

  // Lost flows go downward
  const lostFlows = lostStages.map((l) => {
    const stage = stages.find((s) => s.id === l.fromId);
    const h = nodeHeight(stage.value);
    const y = nodeY(stage);
    const lostH = Math.max(8, (l.value / maxValue) * 200);
    return { ...l, stage, h, y, lostH };
  });

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <p style={{ color: COLORS.textDim, fontSize: 13, margin: 0 }}>
          Showing deal flow across pipeline stages — width represents ARR value · This week vs last week
        </p>
      </div>
      <svg width="100%" viewBox="0 0 900 340" style={{ overflow: "visible" }}>
        {/* Flows between stages */}
        {flows.map((f) => {
          const isHov = hovered === f.key;
          return (
            <g key={f.key}>
              <path
                d={`M ${f.x1} ${f.fy} C ${f.cx} ${f.fy}, ${f.cx} ${f.ty}, ${f.x2} ${f.ty}
                   L ${f.x2} ${f.ty + f.th} C ${f.cx} ${f.ty + f.th}, ${f.cx} ${f.fy + f.fh}, ${f.x1} ${f.fy + f.fh} Z`}
                fill={isHov ? COLORS.teal + "50" : COLORS.teal + "18"}
                stroke={isHov ? COLORS.teal : COLORS.teal + "40"}
                strokeWidth={isHov ? 1 : 0.5}
                style={{ cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={() => setHovered(f.key)}
                onMouseLeave={() => setHovered(null)}
              />
              {isHov && (
                <text
                  x={(f.x1 + f.x2) / 2}
                  y={Math.min(f.fy, f.ty) - 8}
                  textAnchor="middle"
                  fill={COLORS.teal}
                  fontSize={11}
                  fontFamily="Outfit, sans-serif"
                >
                  {f.to.deals} deals · {fmt(f.to.value)}
                </text>
              )}
            </g>
          );
        })}

        {/* Lost flows */}
        {lostFlows.map((l, i) => {
          const lostX = l.stage.x + NODE_W / 2;
          const lostY = l.y + l.h + 4;
          const lostEndY = lostY + 60;
          return (
            <g key={i}>
              <path
                d={`M ${lostX - l.lostH / 2} ${lostY} C ${lostX - l.lostH / 2} ${lostY + 30}, ${lostX - l.lostH / 2} ${lostEndY - 10}, ${lostX - l.lostH / 2} ${lostEndY}
                   L ${lostX + l.lostH / 2} ${lostEndY} C ${lostX + l.lostH / 2} ${lostEndY - 10}, ${lostX + l.lostH / 2} ${lostY + 30}, ${lostX + l.lostH / 2} ${lostY} Z`}
                fill={COLORS.coral + "25"}
                stroke={COLORS.coral + "50"}
                strokeWidth={0.5}
              />
              <text x={lostX} y={lostEndY + 14} textAnchor="middle" fill={COLORS.coral} fontSize={9.5} fontFamily="Outfit, sans-serif">
                -{l.deals} lost
              </text>
              <text x={lostX} y={lostEndY + 25} textAnchor="middle" fill={COLORS.coral + "99"} fontSize={9} fontFamily="Outfit, sans-serif">
                {fmt(l.value)}
              </text>
            </g>
          );
        })}

        {/* Stage nodes */}
        {stages.map((s) => {
          const h = nodeHeight(s.value);
          const y = nodeY(s);
          const isHov = hovered && hovered.startsWith(s.id);
          return (
            <g key={s.id}>
              <rect
                x={s.x}
                y={y}
                width={NODE_W}
                height={h}
                rx={3}
                fill={s.color}
                opacity={0.9}
              />
              {/* Label above */}
              <text x={s.x + NODE_W / 2} y={y - 22} textAnchor="middle" fill={COLORS.text} fontSize={11.5} fontWeight={600} fontFamily="Outfit, sans-serif">
                {s.label}
              </text>
              <text x={s.x + NODE_W / 2} y={y - 10} textAnchor="middle" fill={COLORS.textDim} fontSize={10} fontFamily="Outfit, sans-serif">
                {s.deals} deals
              </text>
              {/* Value below */}
              <text x={s.x + NODE_W / 2} y={y + h + 14} textAnchor="middle" fill={s.color} fontSize={11} fontWeight={600} fontFamily="Outfit, sans-serif">
                {fmt(s.value)}
              </text>
            </g>
          );
        })}

        {/* Legend */}
        <g transform="translate(20, 305)">
          <rect width={10} height={10} rx={2} fill={COLORS.teal + "40"} />
          <text x={14} y={9} fill={COLORS.textDim} fontSize={10} fontFamily="Outfit, sans-serif">Flow to next stage</text>
          <rect x={140} width={10} height={10} rx={2} fill={COLORS.coral + "40"} />
          <text x={154} y={9} fill={COLORS.textDim} fontSize={10} fontFamily="Outfit, sans-serif">Closed lost</text>
          <text x={280} y={9} fill={COLORS.textFaint} fontSize={10} fontFamily="Outfit, sans-serif">Node width = ARR value · Hover flows for detail</text>
        </g>
      </svg>

      {/* Stage conversion table */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 16 }}>
        {[
          { from: "Discovery", to: "Qualification", rate: 73, delta: +4 },
          { from: "Qualification", to: "Proposal", rate: 63, delta: -6 },
          { from: "Proposal", to: "Negotiation", rate: 63, delta: +2 },
          { from: "Negotiation", to: "Closed Won", rate: 60, delta: -8 },
        ].map((r, i) => (
          <div key={i} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, color: COLORS.textFaint, marginBottom: 4 }}>{r.from} → {r.to}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: r.rate >= 65 ? COLORS.green : r.rate >= 50 ? COLORS.amber : COLORS.coral, fontFamily: "Outfit, sans-serif" }}>{r.rate}%</div>
            <div style={{ fontSize: 10, color: r.delta > 0 ? COLORS.green : COLORS.coral, marginTop: 2 }}>
              {r.delta > 0 ? "▲" : "▼"} {Math.abs(r.delta)}pp vs last week
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PATHWAY CHARTING ────────────────────────────────────────────────────────

function PathwayChart() {
  const winPaths = [
    { path: ["Discovery", "Qualification", "Proposal", "Negotiation", "Won"], count: 28, pct: 34, avgDays: 42 },
    { path: ["Discovery", "Proposal", "Negotiation", "Won"], count: 16, pct: 20, avgDays: 31 },
    { path: ["Discovery", "Qualification", "Proposal", "Won"], count: 12, pct: 15, avgDays: 38 },
    { path: ["Qualification", "Proposal", "Negotiation", "Won"], count: 9, pct: 11, avgDays: 29 },
    { path: ["Discovery", "Qualification", "Negotiation", "Won"], count: 6, pct: 7, avgDays: 35 },
  ];
  const lossPaths = [
    { path: ["Discovery", "Qualification", "Proposal", "Lost"], count: 18, pct: 22, avgDays: 67 },
    { path: ["Discovery", "Qualification", "Lost"], count: 14, pct: 17, avgDays: 28 },
    { path: ["Discovery", "Lost"], count: 11, pct: 13, avgDays: 14 },
    { path: ["Discovery", "Qualification", "Proposal", "Negotiation", "Lost"], count: 8, pct: 10, avgDays: 89 },
    { path: ["Qualification", "Proposal", "Lost"], count: 6, pct: 7, avgDays: 35 },
  ];

  const [hovered, setHovered] = useState(null);
  const [mode, setMode] = useState("both");

  const stageColors = {
    "Discovery": COLORS.purple,
    "Qualification": COLORS.teal,
    "Proposal": COLORS.amber,
    "Negotiation": "#60A5FA",
    "Won": COLORS.green,
    "Lost": COLORS.coral,
  };

  const PathRow = ({ item, type, idx }) => {
    const isWin = type === "win";
    const barColor = isWin ? COLORS.teal : COLORS.coral;
    const isHov = hovered === `${type}-${idx}`;
    return (
      <div
        style={{
          background: isHov ? COLORS.card : "transparent",
          border: `1px solid ${isHov ? COLORS.border : "transparent"}`,
          borderRadius: 8,
          padding: "10px 12px",
          cursor: "pointer",
          transition: "all 0.15s",
          marginBottom: 4,
        }}
        onMouseEnter={() => setHovered(`${type}-${idx}`)}
        onMouseLeave={() => setHovered(null)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          {item.path.map((stage, si) => (
            <div key={si} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{
                background: stageColors[stage] + "25",
                color: stageColors[stage],
                border: `1px solid ${stageColors[stage]}50`,
                borderRadius: 4,
                padding: "2px 7px",
                fontSize: 10.5,
                fontWeight: 600,
                fontFamily: "Outfit, sans-serif",
                whiteSpace: "nowrap",
              }}>{stage}</span>
              {si < item.path.length - 1 && (
                <span style={{ color: COLORS.textFaint, fontSize: 10 }}>›</span>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, height: 4, background: COLORS.border, borderRadius: 2 }}>
            <div style={{ width: `${item.pct}%`, height: "100%", background: barColor, borderRadius: 2, transition: "width 0.5s" }} />
          </div>
          <span style={{ fontSize: 11, color: barColor, fontWeight: 700, minWidth: 30 }}>{item.pct}%</span>
          <span style={{ fontSize: 10, color: COLORS.textFaint, minWidth: 60 }}>{item.count} deals</span>
          <span style={{ fontSize: 10, color: COLORS.textDim }}>avg {item.avgDays}d</span>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <p style={{ color: COLORS.textDim, fontSize: 13, margin: 0 }}>
          Actual deal paths taken — ranked by frequency · Trailing 12 months · 82 won, 57 lost
        </p>
        <div style={{ display: "flex", gap: 4 }}>
          {["both", "wins", "losses"].map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                background: mode === m ? COLORS.teal + "20" : "transparent",
                border: `1px solid ${mode === m ? COLORS.teal : COLORS.border}`,
                color: mode === m ? COLORS.teal : COLORS.textDim,
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "Outfit, sans-serif",
                textTransform: "capitalize",
              }}
            >{m}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: mode === "both" ? "1fr 1fr" : "1fr", gap: 16 }}>
        {(mode === "both" || mode === "wins") && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS.green }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.green, fontFamily: "Outfit, sans-serif" }}>WINNING PATHS</span>
            </div>
            {winPaths.map((p, i) => <PathRow key={i} item={p} type="win" idx={i} />)}
          </div>
        )}
        {(mode === "both" || mode === "losses") && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS.coral }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.coral, fontFamily: "Outfit, sans-serif" }}>LOSING PATHS</span>
            </div>
            {lossPaths.map((p, i) => <PathRow key={i} item={p} type="loss" idx={i} />)}
          </div>
        )}
      </div>

      {/* Key insight callout */}
      <div style={{ marginTop: 16, background: COLORS.tealFaint, border: `1px solid ${COLORS.teal}30`, borderRadius: 10, padding: "12px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span style={{ fontSize: 16 }}>💡</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.teal, fontFamily: "Outfit, sans-serif", marginBottom: 3 }}>Pandora finding</div>
          <div style={{ fontSize: 12, color: COLORS.textDim, lineHeight: 1.5 }}>
            Deals that skip Qualification go to Closed Won in <strong style={{ color: COLORS.text }}>31 days avg</strong> vs 42 days for the full path — but win rate is <strong style={{ color: COLORS.coral }}>12pp lower</strong>. Fast ≠ better here.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CANONICAL PATHWAYS ──────────────────────────────────────────────────────

function CanonicalPathways() {
  const [activeTab, setActiveTab] = useState("smb");

  const segments = {
    smb: {
      label: "SMB (<$25K ACV)",
      path: ["Discovery", "Proposal", "Closed Won"],
      benchmarks: { winRate: 38, avgDays: 28, dropStages: ["Qualification"] },
      color: COLORS.teal,
    },
    mid: {
      label: "Mid-Market ($25–$100K)",
      path: ["Discovery", "Qualification", "Proposal", "Negotiation", "Closed Won"],
      benchmarks: { winRate: 29, avgDays: 52, dropStages: [] },
      color: COLORS.amber,
    },
    ent: {
      label: "Enterprise (>$100K)",
      path: ["Discovery", "Qualification", "Proposal", "Negotiation", "Closed Won"],
      benchmarks: { winRate: 22, avgDays: 94, dropStages: [] },
      color: COLORS.purple,
    },
  };

  const stageVelocity = {
    smb: [
      { stage: "Discovery", benchmark: 7, current: 9, status: "warn" },
      { stage: "Proposal", benchmark: 14, current: 12, status: "good" },
      { stage: "Closed Won", benchmark: null, current: null, status: null },
    ],
    mid: [
      { stage: "Discovery", benchmark: 10, current: 10, status: "good" },
      { stage: "Qualification", benchmark: 12, current: 18, status: "bad" },
      { stage: "Proposal", benchmark: 14, current: 15, status: "good" },
      { stage: "Negotiation", benchmark: 10, current: 8, status: "good" },
      { stage: "Closed Won", benchmark: null, current: null, status: null },
    ],
    ent: [
      { stage: "Discovery", benchmark: 14, current: 21, status: "bad" },
      { stage: "Qualification", benchmark: 21, current: 19, status: "good" },
      { stage: "Proposal", benchmark: 28, current: 31, status: "warn" },
      { stage: "Negotiation", benchmark: 21, current: 24, status: "warn" },
      { stage: "Closed Won", benchmark: null, current: null, status: null },
    ],
  };

  const seg = segments[activeTab];
  const velocity = stageVelocity[activeTab];

  const statusColor = { good: COLORS.green, warn: COLORS.amber, bad: COLORS.coral };
  const statusLabel = { good: "On track", warn: "Slow", bad: "Bottleneck" };
  const stageColors = {
    "Discovery": COLORS.purple,
    "Qualification": COLORS.teal,
    "Proposal": COLORS.amber,
    "Negotiation": "#60A5FA",
    "Closed Won": COLORS.green,
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <p style={{ color: COLORS.textDim, fontSize: 13, margin: 0 }}>
          Prescribed stage sequence by segment — derived from winning deal paths · Used as benchmark in Pipeline Hygiene + Rep Scorecard
        </p>
      </div>

      {/* Segment tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {Object.entries(segments).map(([key, s]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              background: activeTab === key ? s.color + "20" : "transparent",
              border: `1px solid ${activeTab === key ? s.color : COLORS.border}`,
              color: activeTab === key ? s.color : COLORS.textDim,
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 11.5,
              cursor: "pointer",
              fontFamily: "Outfit, sans-serif",
              fontWeight: activeTab === key ? 600 : 400,
              transition: "all 0.15s",
            }}
          >{s.label}</button>
        ))}
      </div>

      {/* Canonical path visualization */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: COLORS.textFaint, fontFamily: "Outfit, sans-serif", marginBottom: 14 }}>CANONICAL PATH</div>
        <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap" }}>
          {seg.path.map((stage, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center" }}>
              <div style={{
                background: stageColors[stage] + "20",
                border: `2px solid ${stageColors[stage]}`,
                borderRadius: 10,
                padding: "10px 16px",
                textAlign: "center",
                minWidth: 110,
              }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: stageColors[stage], fontFamily: "Outfit, sans-serif" }}>{stage}</div>
                {velocity.find(v => v.stage === stage)?.benchmark && (
                  <div style={{ fontSize: 10, color: COLORS.textFaint, marginTop: 2 }}>
                    target: {velocity.find(v => v.stage === stage).benchmark}d
                  </div>
                )}
              </div>
              {i < seg.path.length - 1 && (
                <div style={{ padding: "0 6px", color: COLORS.textFaint, fontSize: 18 }}>→</div>
              )}
            </div>
          ))}
        </div>

        {/* Skipped stages note */}
        {seg.benchmarks.dropStages.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: COLORS.textFaint }}>Stages typically skipped for this segment:</span>
            {seg.benchmarks.dropStages.map((s, i) => (
              <span key={i} style={{ fontSize: 10, color: COLORS.amber, background: COLORS.amberFaint, border: `1px solid ${COLORS.amber}40`, borderRadius: 4, padding: "1px 6px" }}>
                {s} (skipped 68% of the time)
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Velocity benchmarks */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: COLORS.textFaint, fontFamily: "Outfit, sans-serif", marginBottom: 10 }}>CURRENT VS BENCHMARK — DAYS IN STAGE</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {velocity.filter(v => v.benchmark !== null).map((v, i) => {
            const ratio = v.current / v.benchmark;
            const barWidth = Math.min(ratio * 50, 100);
            const benchmarkBarWidth = 50;
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "110px 1fr 60px 80px", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 11.5, color: COLORS.text, fontFamily: "Outfit, sans-serif" }}>{v.stage}</span>
                <div style={{ position: "relative", height: 16 }}>
                  {/* benchmark line */}
                  <div style={{ position: "absolute", left: `${benchmarkBarWidth}%`, top: 0, bottom: 0, width: 2, background: COLORS.textFaint + "80", borderRadius: 1 }} />
                  {/* current bar */}
                  <div style={{
                    position: "absolute", left: 0, top: 4, height: 8,
                    width: `${barWidth}%`,
                    background: statusColor[v.status],
                    borderRadius: 3,
                    opacity: 0.8,
                    transition: "width 0.5s",
                  }} />
                </div>
                <span style={{ fontSize: 11, color: statusColor[v.status], fontWeight: 600, fontFamily: "Outfit, sans-serif" }}>
                  {v.current}d <span style={{ fontWeight: 400, color: COLORS.textFaint }}>/ {v.benchmark}d</span>
                </span>
                <span style={{
                  fontSize: 10, color: statusColor[v.status],
                  background: statusColor[v.status] + "15",
                  border: `1px solid ${statusColor[v.status]}40`,
                  borderRadius: 4, padding: "2px 7px",
                  textAlign: "center",
                }}>
                  {statusLabel[v.status]}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 6, fontSize: 10, color: COLORS.textFaint }}>
          Vertical line = benchmark · Bar = current actuals
        </div>
      </div>

      {/* Win rate + cycle time summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: COLORS.textFaint, marginBottom: 4 }}>Win Rate (canonical path)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.green, fontFamily: "Outfit, sans-serif" }}>{seg.benchmarks.winRate}%</div>
          <div style={{ fontSize: 10, color: COLORS.textFaint, marginTop: 2 }}>deals following this path</div>
        </div>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: COLORS.textFaint, marginBottom: 4 }}>Avg Cycle Time</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.amber, fontFamily: "Outfit, sans-serif" }}>{seg.benchmarks.avgDays}d</div>
          <div style={{ fontSize: 10, color: COLORS.textFaint, marginTop: 2 }}>target for this segment</div>
        </div>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: COLORS.textFaint, marginBottom: 4 }}>Path Compliance</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.teal, fontFamily: "Outfit, sans-serif" }}>61%</div>
          <div style={{ fontSize: 10, color: COLORS.textFaint, marginTop: 2 }}>open deals following canonical</div>
        </div>
      </div>
    </div>
  );
}

// ─── SHELL ───────────────────────────────────────────────────────────────────

const TABS = [
  { id: "sankey", label: "Sankey Diagram", sub: "Pipeline Waterfall", icon: "⟳" },
  { id: "pathway", label: "Pathway Charting", sub: "Win / Loss Paths", icon: "⤷" },
  { id: "canonical", label: "Canonical Pathways", sub: "Segment Benchmarks", icon: "✦" },
];

export default function App() {
  const [active, setActive] = useState("sankey");

  return (
    <div style={{
      background: COLORS.bg,
      minHeight: "100vh",
      fontFamily: "'Outfit', 'IBM Plex Sans', sans-serif",
      color: COLORS.text,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${COLORS.border}`, padding: "14px 24px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 28, height: 28, background: `linear-gradient(135deg, ${COLORS.teal}, ${COLORS.coral})`, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>P</div>
        <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.text }}>Pandora</span>
        <span style={{ fontSize: 12, color: COLORS.textFaint, marginLeft: 4 }}>/ Pipeline Waterfall</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 11, color: COLORS.textFaint }}>Frontera · HubSpot</div>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.green }} />
        </div>
      </div>

      <div style={{ padding: "20px 24px" }}>
        {/* Tab bar */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, background: COLORS.surface, borderRadius: 10, padding: 4, width: "fit-content", border: `1px solid ${COLORS.border}` }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              style={{
                background: active === t.id ? COLORS.card : "transparent",
                border: `1px solid ${active === t.id ? COLORS.border : "transparent"}`,
                borderRadius: 7,
                padding: "7px 16px",
                cursor: "pointer",
                transition: "all 0.15s",
                textAlign: "left",
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: active === t.id ? 600 : 400, color: active === t.id ? COLORS.text : COLORS.textDim, fontFamily: "Outfit, sans-serif" }}>
                {t.label}
              </div>
              <div style={{ fontSize: 10, color: active === t.id ? COLORS.teal : COLORS.textFaint, marginTop: 1 }}>
                {t.sub}
              </div>
            </button>
          ))}
        </div>

        {/* Usage context banner */}
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "10px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: COLORS.textFaint }}>Used in:</span>
          {active === "sankey" && (
            <>
              <Tag color={COLORS.teal}>Pipeline Waterfall skill</Tag>
              <Tag color={COLORS.purple}>Bowtie Funnel Review agent</Tag>
            </>
          )}
          {active === "pathway" && (
            <>
              <Tag color={COLORS.teal}>ICP Discovery skill</Tag>
              <Tag color={COLORS.amber}>Rep Scorecard</Tag>
              <Tag color={COLORS.purple}>Bowtie Funnel Review agent</Tag>
            </>
          )}
          {active === "canonical" && (
            <>
              <Tag color={COLORS.teal}>Workspace Config (onboarding)</Tag>
              <Tag color={COLORS.amber}>Pipeline Hygiene benchmark</Tag>
              <Tag color={COLORS.purple}>Rep Scorecard benchmark</Tag>
            </>
          )}
        </div>

        {/* Content */}
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 24 }}>
          {active === "sankey" && <SankeyDiagram />}
          {active === "pathway" && <PathwayChart />}
          {active === "canonical" && <CanonicalPathways />}
        </div>
      </div>
    </div>
  );
}

function Tag({ children, color }) {
  return (
    <span style={{
      fontSize: 10.5,
      color: color,
      background: color + "15",
      border: `1px solid ${color}40`,
      borderRadius: 5,
      padding: "2px 8px",
      fontFamily: "Outfit, sans-serif",
    }}>{children}</span>
  );
}
