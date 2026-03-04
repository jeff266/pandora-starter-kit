import { useState } from "react";

const PROSPECTS = [
  {
    id: "ps_001",
    name: "Sarah Chen",
    email: "schen@acmesaas.com",
    title: "VP of Operations",
    company: "Acme SaaS",
    companySize: 180,
    industry: "SaaS",
    source: "hubspot",
    sourceObject: "contact",
    score: 78,
    prevScore: 61,
    grade: "B",
    method: "recursive_tree",
    confidence: 0.82,
    segment: "SaaS / 51–200 emp / VP-level",
    summary: "Strong ICP fit (VP Ops at 180-person SaaS co), 3 meetings this month, no deal created yet.",
    recommendedAction: "prospect",
    topPositive: "Industry match: SaaS (+12 pts)",
    topNegative: "No deal association (−8 pts)",
    fit: 88, engagement: 72, intent: 65, timing: 81,
    scoredAt: "2026-03-10T07:00:58Z",
    factors: [
      { field: "industry", label: "Industry Match", value: "SaaS", contribution: 12, maxPossible: 15, direction: "positive", category: "fit", benchmark: { populationAvg: 6.2, percentile: 84, wonDealAvg: 11.8 }, explanation: "SaaS companies convert at 2.4x your overall average." },
      { field: "seniority", label: "Seniority Match", value: "VP", contribution: 10, maxPossible: 12, direction: "positive", category: "fit", benchmark: { populationAvg: 5.8, percentile: 79, wonDealAvg: 9.4 }, explanation: "VP-level contacts are present in 73% of won deals." },
      { field: "meeting_held", label: "Meeting Held", value: "3 this month", contribution: 10, maxPossible: 10, direction: "positive", category: "engagement", benchmark: { populationAvg: 3.1, percentile: 91, wonDealAvg: 8.8 }, explanation: "Multiple meetings in a single month is a strong buying signal." },
      { field: "company_size", label: "Company Size", value: "180 employees", contribution: 8, maxPossible: 10, direction: "positive", category: "fit", benchmark: { populationAvg: 5.0, percentile: 72, wonDealAvg: 7.6 }, explanation: "51–200 employee companies are your ICP sweet spot." },
      { field: "email_frequency", label: "Email Activity", value: "5 emails / 30d", contribution: 5, maxPossible: 5, direction: "positive", category: "engagement", benchmark: { populationAvg: 2.8, percentile: 68, wonDealAvg: 4.2 }, explanation: "Above-average email engagement in the last 30 days." },
      { field: "account_signals", label: "Account Signals", value: "Series B funding", contribution: 5, maxPossible: 5, direction: "positive", category: "timing", benchmark: { populationAvg: 1.9, percentile: 82, wonDealAvg: 4.1 }, explanation: "Recent funding events correlate with buying triggers." },
      { field: "has_open_deal", label: "No Deal Association", value: "false", contribution: -8, maxPossible: 10, direction: "negative", category: "intent", benchmark: { populationAvg: 4.2, percentile: 22, wonDealAvg: 9.1 }, explanation: "High-scoring prospect not on any open deal — potential missed opportunity." },
      { field: "multi_threaded", label: "Multi-Threading", value: "Solo contact", contribution: -4, maxPossible: 5, direction: "negative", category: "intent", benchmark: { populationAvg: 2.1, percentile: 31, wonDealAvg: 4.0 }, explanation: "No other engaged contacts at this account." },
    ],
    segmentBenchmarks: { meetingRate: 0.64, conversionRate: 0.45, winRate: 0.38, avgDealSize: 72000, avgSalesCycle: 34 },
  },
  {
    id: "ps_002", name: "Marcus Rivera", email: "mrivera@techflow.io", title: "Director of Engineering",
    company: "TechFlow", companySize: 320, industry: "SaaS", source: "salesforce", sourceObject: "contact",
    score: 91, prevScore: 85, grade: "A", method: "recursive_tree", confidence: 0.88,
    segment: "SaaS / 201–1000 emp / Director+", summary: "A-grade ICP fit with active deal in Evaluation stage. Champion language detected in last call.",
    recommendedAction: "multi_thread", topPositive: "Champion language detected (+14 pts)", topNegative: "Single-threaded deal (−5 pts)",
    fit: 92, engagement: 94, intent: 88, timing: 85, scoredAt: "2026-03-10T07:00:58Z",
    factors: [], segmentBenchmarks: { meetingRate: 0.71, conversionRate: 0.52, winRate: 0.44, avgDealSize: 95000, avgSalesCycle: 41 },
  },
  {
    id: "ps_003", name: "Priya Patel", email: "ppatel@novahealth.com", title: "Head of Revenue Operations",
    company: "Nova Health", companySize: 95, industry: "Healthcare", source: "hubspot", sourceObject: "lead",
    score: 68, prevScore: 71, grade: "B", method: "recursive_tree", confidence: 0.76,
    segment: "Healthcare / 51–200 emp / Manager+", summary: "Good engagement (2 calls, 4 emails) but industry slightly outside core ICP. Score declining — last activity 11 days ago.",
    recommendedAction: "reengage", topPositive: "RevOps title match (+11 pts)", topNegative: "Industry: Healthcare (−6 pts vs SaaS)",
    fit: 62, engagement: 58, intent: 72, timing: 55, scoredAt: "2026-03-10T07:00:58Z",
    factors: [], segmentBenchmarks: { meetingRate: 0.38, conversionRate: 0.28, winRate: 0.22, avgDealSize: 48000, avgSalesCycle: 58 },
  },
  {
    id: "ps_004", name: "Jordan Kim", email: "jkim@scaleup.dev", title: "CRO",
    company: "ScaleUp", companySize: 75, industry: "SaaS", source: "hubspot", sourceObject: "contact",
    score: 85, prevScore: 62, grade: "A", method: "recursive_tree", confidence: 0.84,
    segment: "SaaS / 51–200 emp / C-level", summary: "Score jumped +23 this week — booked first meeting, C-level title, strong account signals (hiring 3 AEs).",
    recommendedAction: "prospect", topPositive: "C-level seniority (+13 pts)", topNegative: "No prior deal history (−4 pts)",
    fit: 90, engagement: 76, intent: 70, timing: 92, scoredAt: "2026-03-10T07:00:58Z",
    factors: [], segmentBenchmarks: { meetingRate: 0.58, conversionRate: 0.48, winRate: 0.41, avgDealSize: 68000, avgSalesCycle: 29 },
  },
  {
    id: "ps_005", name: "Lisa Wong", email: "lwong@datacore.ai", title: "Sales Manager",
    company: "DataCore AI", companySize: 420, industry: "AI/ML", source: "salesforce", sourceObject: "lead",
    score: 42, prevScore: 55, grade: "C", method: "recursive_tree", confidence: 0.71,
    segment: "AI-ML / 201–1000 emp / Manager", summary: "Declining engagement — no activity in 19 days. Initial interest faded after discovery call. Consider nurture sequence.",
    recommendedAction: "nurture", topPositive: "Company size in range (+7 pts)", topNegative: "19 days inactive (−15 pts)",
    fit: 58, engagement: 22, intent: 45, timing: 30, scoredAt: "2026-03-10T07:00:58Z",
    factors: [], segmentBenchmarks: { meetingRate: 0.29, conversionRate: 0.18, winRate: 0.14, avgDealSize: 52000, avgSalesCycle: 67 },
  },
];

const GRADE_COLORS = { A: "#10b981", B: "#3b82f6", C: "#f59e0b", D: "#f97316", F: "#ef4444" };
const ACTION_LABELS = { prospect: "Create Opportunity", reengage: "Re-engage", multi_thread: "Multi-Thread", nurture: "Nurture", disqualify: "Disqualify" };
const ACTION_COLORS = { prospect: "#10b981", reengage: "#f59e0b", multi_thread: "#8b5cf6", nurture: "#6366f1", disqualify: "#ef4444" };
const CATEGORY_LABELS = { fit: "Fit", engagement: "Engagement", intent: "Intent", timing: "Timing" };
const CATEGORY_COLORS = { fit: "#3b82f6", engagement: "#10b981", intent: "#f59e0b", timing: "#8b5cf6" };

function ScoreRing({ score, size = 48, stroke = 4, grade }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = GRADE_COLORS[grade] || "#6b7280";
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.8s ease" }} />
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        fill={color} fontSize={size * 0.32} fontWeight="700"
        style={{ transform: "rotate(90deg)", transformOrigin: "center" }}>{score}</text>
    </svg>
  );
}

function ComponentBar({ label, value, color }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500, letterSpacing: "0.02em" }}>{label}</span>
        <span style={{ fontSize: 11, color, fontWeight: 700 }}>{value}</span>
      </div>
      <div style={{ height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

function FactorRow({ factor, maxContribution }) {
  const isPositive = factor.direction === "positive";
  const barColor = isPositive ? "#10b981" : "#ef4444";
  const absContrib = Math.abs(factor.contribution);
  const barWidth = (absContrib / maxContribution) * 100;
  const catColor = CATEGORY_COLORS[factor.category] || "#6b7280";

  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid #1e293b" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: catColor, textTransform: "uppercase",
            letterSpacing: "0.08em", background: `${catColor}15`, padding: "2px 6px", borderRadius: 3 }}>
            {CATEGORY_LABELS[factor.category]}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{factor.label}</span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: barColor, fontVariantNumeric: "tabular-nums" }}>
          {isPositive ? "+" : "−"}{absContrib} pts
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div style={{ flex: 1, height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ width: `${barWidth}%`, height: "100%", background: barColor, borderRadius: 3, opacity: 0.8, transition: "width 0.4s ease" }} />
        </div>
        <span style={{ fontSize: 11, color: "#64748b", minWidth: 60, textAlign: "right" }}>
          of {factor.maxPossible} max
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>Value:</span>
        <span style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 500 }}>{factor.value}</span>
      </div>
      {factor.benchmark && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ fontSize: 10, color: "#64748b" }}>
            Pop. avg: <span style={{ color: "#94a3b8", fontWeight: 600 }}>{factor.benchmark.populationAvg}</span>
          </div>
          <div style={{ fontSize: 10, color: "#64748b" }}>
            Percentile: <span style={{ color: "#94a3b8", fontWeight: 600 }}>{factor.benchmark.percentile}th</span>
          </div>
          <div style={{ fontSize: 10, color: "#64748b" }}>
            Won-deal avg: <span style={{ color: "#10b981", fontWeight: 600 }}>{factor.benchmark.wonDealAvg}</span>
          </div>
        </div>
      )}
      {factor.explanation && (
        <p style={{ fontSize: 11, color: "#64748b", margin: "4px 0 0", lineHeight: 1.4, fontStyle: "italic" }}>
          {factor.explanation}
        </p>
      )}
    </div>
  );
}

function ProspectDetail({ prospect, onBack }) {
  const p = prospect;
  const maxContrib = Math.max(...p.factors.map(f => Math.abs(f.contribution)), 1);
  const positiveFactors = p.factors.filter(f => f.direction === "positive").sort((a, b) => b.contribution - a.contribution);
  const negativeFactors = p.factors.filter(f => f.direction === "negative").sort((a, b) => a.contribution - b.contribution);
  const scoreChange = p.score - p.prevScore;
  const bm = p.segmentBenchmarks;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, cursor: "pointer" }} onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span style={{ fontSize: 12, color: "#64748b" }}>Back to prospects</span>
      </div>

      {/* Profile card */}
      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#f1f5f9" }}>{p.name}</h2>
              <span style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", background: "#1e293b", padding: "2px 8px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {p.source} {p.sourceObject}
              </span>
            </div>
            <p style={{ margin: "0 0 2px", fontSize: 13, color: "#94a3b8" }}>{p.title} at {p.company}</p>
            <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>{p.email}</p>
            <div style={{ marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: ACTION_COLORS[p.recommendedAction],
                background: `${ACTION_COLORS[p.recommendedAction]}18`, padding: "4px 10px", borderRadius: 5, letterSpacing: "0.02em" }}>
                ▸ {ACTION_LABELS[p.recommendedAction]}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <ScoreRing score={p.score} size={72} stroke={5} grade={p.grade} />
            <div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Grade</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: GRADE_COLORS[p.grade] }}>{p.grade}</div>
              <div style={{ fontSize: 11, color: scoreChange >= 0 ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                {scoreChange >= 0 ? "▲" : "▼"} {Math.abs(scoreChange)} pts
              </div>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div style={{ marginTop: 14, padding: 12, background: "#1e293b", borderRadius: 8, borderLeft: `3px solid ${GRADE_COLORS[p.grade]}` }}>
          <p style={{ margin: 0, fontSize: 12, color: "#cbd5e1", lineHeight: 1.5 }}>{p.summary}</p>
        </div>

        {/* Component scores */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
          <ComponentBar label="FIT" value={p.fit} color={CATEGORY_COLORS.fit} />
          <ComponentBar label="ENGAGEMENT" value={p.engagement} color={CATEGORY_COLORS.engagement} />
          <ComponentBar label="INTENT" value={p.intent} color={CATEGORY_COLORS.intent} />
          <ComponentBar label="TIMING" value={p.timing} color={CATEGORY_COLORS.timing} />
        </div>
      </div>

      {/* Segment benchmarks */}
      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 12l3-4 3 2 4-6" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#c4b5fd", letterSpacing: "0.02em" }}>Segment Benchmarks</h3>
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12, padding: "4px 8px", background: "#1e293b", borderRadius: 4, display: "inline-block" }}>
          {p.segment}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 8 }}>
          {[
            { label: "Meeting Rate", value: `${(bm.meetingRate * 100).toFixed(0)}%` },
            { label: "Conversion", value: `${(bm.conversionRate * 100).toFixed(0)}%` },
            { label: "Win Rate", value: `${(bm.winRate * 100).toFixed(0)}%` },
            { label: "Avg Deal", value: `$${(bm.avgDealSize / 1000).toFixed(0)}K` },
            { label: "Avg Cycle", value: `${bm.avgSalesCycle}d` },
          ].map((m, i) => (
            <div key={i} style={{ background: "#1e293b", borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{m.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>{m.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Factor breakdown — SHOW YOUR MATH */}
      {p.factors.length > 0 && (
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3h10M3 8h7M3 13h4" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round"/></svg>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#fbbf24", letterSpacing: "0.02em" }}>Score Factors — Show Your Math</h3>
            </div>
            <span style={{ fontSize: 10, color: "#64748b" }}>Method: {p.method} • Confidence: {(p.confidence * 100).toFixed(0)}%</span>
          </div>

          {positiveFactors.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#10b981", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4, padding: "0 0 4px", borderBottom: "1px solid #1e293b" }}>
                Positive Factors
              </div>
              {positiveFactors.map((f, i) => <FactorRow key={i} factor={f} maxContribution={maxContrib} />)}
            </div>
          )}

          {negativeFactors.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4, marginTop: 12, padding: "0 0 4px", borderBottom: "1px solid #1e293b" }}>
                Negative Factors
              </div>
              {negativeFactors.map((f, i) => <FactorRow key={i} factor={f} maxContribution={maxContrib} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProspectRow({ prospect, onSelect }) {
  const p = prospect;
  const scoreChange = p.score - p.prevScore;
  return (
    <div onClick={() => onSelect(p)} style={{ display: "flex", alignItems: "center", padding: "12px 16px",
      background: "#0f172a", borderBottom: "1px solid #1e293b", cursor: "pointer", transition: "background 0.15s",
      gap: 12 }}
      onMouseEnter={e => e.currentTarget.style.background = "#1a2744"}
      onMouseLeave={e => e.currentTarget.style.background = "#0f172a"}>
      <ScoreRing score={p.score} size={40} stroke={3} grade={p.grade} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9" }}>{p.name}</span>
          <span style={{ fontSize: 10, color: "#64748b" }}>•</span>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>{p.title}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
          <span style={{ fontSize: 11, color: "#64748b" }}>{p.company}</span>
          <span style={{ fontSize: 9, color: "#475569", background: "#1e293b", padding: "1px 5px", borderRadius: 3 }}>{p.industry}</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
        <div style={{ display: "none", alignItems: "center", gap: 16 }} className="desktop-cols">
          {[
            { label: "FIT", val: p.fit, color: CATEGORY_COLORS.fit },
            { label: "ENG", val: p.engagement, color: CATEGORY_COLORS.engagement },
            { label: "INT", val: p.intent, color: CATEGORY_COLORS.intent },
            { label: "TIM", val: p.timing, color: CATEGORY_COLORS.timing },
          ].map((c, i) => (
            <div key={i} style={{ textAlign: "center", minWidth: 36 }}>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.06em" }}>{c.label}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: c.color }}>{c.val}</div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "right", minWidth: 48 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: scoreChange >= 0 ? "#10b981" : "#ef4444" }}>
            {scoreChange >= 0 ? "▲" : "▼"}{Math.abs(scoreChange)}
          </div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 600, color: ACTION_COLORS[p.recommendedAction],
          background: `${ACTION_COLORS[p.recommendedAction]}15`, padding: "3px 8px", borderRadius: 4,
          whiteSpace: "nowrap" }}>
          {ACTION_LABELS[p.recommendedAction]}
        </span>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
          <path d="M6 4l4 4-4 4" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </div>
  );
}

export default function PandoraProspectScore() {
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("all");

  const gradeDistrib = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  PROSPECTS.forEach(p => gradeDistrib[p.grade]++);

  const filtered = filter === "all" ? PROSPECTS : PROSPECTS.filter(p => p.grade === filter);

  return (
    <div style={{ fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif", background: "#020617",
      color: "#e2e8f0", minHeight: "100vh", maxWidth: 860, margin: "0 auto" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,500;0,9..40,700;0,9..40,800&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0f172a; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
        @media (min-width: 640px) { .desktop-cols { display: flex !important; } }
      `}</style>

      {/* Top bar */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #1e293b", display: "flex",
        alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#fff" }}>P</div>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.01em" }}>Prospect Score</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#64748b" }}>Tier 4 — Recursive Tree</span>
          <span style={{ fontSize: 10, color: "#475569" }}>•</span>
          <span style={{ fontSize: 10, color: "#64748b" }}>3,891 scored</span>
          <span style={{ fontSize: 10, color: "#475569" }}>•</span>
          <span style={{ fontSize: 10, color: "#64748b" }}>Updated 4h ago</span>
        </div>
      </div>

      <div style={{ padding: 20 }}>
        {selected ? (
          <ProspectDetail prospect={selected} onBack={() => setSelected(null)} />
        ) : (
          <>
            {/* Grade distribution */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <button onClick={() => setFilter("all")}
                style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${filter === "all" ? "#3b82f6" : "#1e293b"}`,
                  background: filter === "all" ? "#1e3a5f" : "#0f172a", color: filter === "all" ? "#93c5fd" : "#94a3b8",
                  fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}>
                All ({PROSPECTS.length})
              </button>
              {Object.entries(gradeDistrib).map(([grade, count]) => (
                <button key={grade} onClick={() => setFilter(grade)}
                  style={{ padding: "6px 14px", borderRadius: 6,
                    border: `1px solid ${filter === grade ? GRADE_COLORS[grade] : "#1e293b"}`,
                    background: filter === grade ? `${GRADE_COLORS[grade]}18` : "#0f172a",
                    color: filter === grade ? GRADE_COLORS[grade] : "#64748b",
                    fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}>
                  {grade} ({count})
                </button>
              ))}
            </div>

            {/* Summary stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 16 }}>
              {[
                { label: "Avg Score", value: Math.round(PROSPECTS.reduce((s, p) => s + p.score, 0) / PROSPECTS.length), suffix: "" },
                { label: "A-Grade", value: gradeDistrib.A, suffix: " prospects" },
                { label: "Unworked A/B", value: PROSPECTS.filter(p => ["A","B"].includes(p.grade) && p.recommendedAction === "prospect").length, suffix: "" },
                { label: "Score ▲ This Week", value: PROSPECTS.filter(p => p.score > p.prevScore).length, suffix: ` of ${PROSPECTS.length}` },
              ].map((s, i) => (
                <div key={i} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px" }}>
                  <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9" }}>{s.value}<span style={{ fontSize: 11, fontWeight: 500, color: "#64748b" }}>{s.suffix}</span></div>
                </div>
              ))}
            </div>

            {/* Column headers */}
            <div style={{ display: "flex", alignItems: "center", padding: "8px 16px", gap: 12 }}>
              <div style={{ width: 40 }} />
              <div style={{ flex: 1, fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Prospect</div>
              <div style={{ display: "none", alignItems: "center", gap: 16, fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }} className="desktop-cols">
                <span style={{ minWidth: 36, textAlign: "center" }}>Fit</span>
                <span style={{ minWidth: 36, textAlign: "center" }}>Eng</span>
                <span style={{ minWidth: 36, textAlign: "center" }}>Int</span>
                <span style={{ minWidth: 36, textAlign: "center" }}>Tim</span>
              </div>
              <span style={{ minWidth: 48, textAlign: "right", fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Δ</span>
              <span style={{ minWidth: 80, fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Action</span>
              <div style={{ width: 14 }} />
            </div>

            {/* Prospect list */}
            <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid #1e293b" }}>
              {filtered.map(p => <ProspectRow key={p.id} prospect={p} onSelect={setSelected} />)}
            </div>

            {/* Webhook hint */}
            <div style={{ marginTop: 16, padding: 12, background: "#0f172a", border: "1px solid #1e293b",
              borderRadius: 8, display: "flex", alignItems: "center", gap: 10 }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v5l3 3" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="8" cy="8" r="6" stroke="#64748b" strokeWidth="1.5"/>
              </svg>
              <span style={{ fontSize: 11, color: "#64748b" }}>
                All fields available via webhook (prospect.scored events) and CRM writeback.
                13 Pandora fields per prospect — score, grade, 4 components, summary, segment, benchmarks, factors, action.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
