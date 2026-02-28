import { useState } from "react";

const COLORS = {
  bg: "#0a0b0f",
  surface: "#12141a",
  surfaceHover: "#181b23",
  border: "#1e2130",
  borderSubtle: "#161825",
  text: "#e8eaf0",
  textMuted: "#7a7f94",
  textDim: "#4a4f62",
  accent: "#6366f1",
  accentGlow: "rgba(99, 102, 241, 0.15)",
  risk: "#f59e0b",
  riskBg: "rgba(245, 158, 11, 0.08)",
  riskBorder: "rgba(245, 158, 11, 0.2)",
  danger: "#ef4444",
  dangerBg: "rgba(239, 68, 68, 0.08)",
  dangerBorder: "rgba(239, 68, 68, 0.2)",
  success: "#10b981",
  successBg: "rgba(16, 185, 129, 0.08)",
};

const dealData = {
  name: "RENEWAL - Delek EDR FCC and TYR FCC CDU",
  amount: "$1.48M",
  stage: "11 - Expansion Alignment",
  stageType: "Evaluation",
  bScore: 86.67,
  owner: "steve.beitz@imubit.com",
  closeDate: "Dec 30, 2030",
  account: "Delek US Holdings Inc. (PARENT ACCOUNT)",
  probability: "85.00%",
  forecast: "best_case",
  contacts: [
    { name: "Ido Biger", title: "Chief Technology Officer", role: "Decision Maker", engaged: false },
    { name: "Jimmy Crosby", title: "Senior VP, Strategic Planning", role: "Decision Maker", engaged: false },
    { name: "Tim Crutcher", title: "VP, Economics & Planning", role: "Decision Maker", engaged: false },
    { name: "Iddo Salton", title: "VP, Innovation, Data & AI", role: "Decision Maker", engaged: false },
    { name: "John Escarcega", title: "Corporate APC Manager", role: "Influencer", engaged: false },
    { name: "John Park", title: "Senior Manager, Procurement", role: "Influencer", engaged: false },
    { name: "Joshua Price", title: "Senior Director, Planning & Economics", role: "Influencer", engaged: false },
    { name: "Shane Roberts", title: "Program Manager, IT", role: "Influencer", engaged: false },
    { name: "Daryl Schofield", title: "EVP, Business Development", role: "Economic Buyer", engaged: false },
    { name: "Nithia Thaver", title: "SVP Refining", role: "Unknown", engaged: false },
  ],
};

const roleColors = {
  "Decision Maker": "#ef4444",
  "Influencer": "#6366f1",
  "Economic Buyer": "#f59e0b",
  "Unknown": "#4a4f62",
};

function BScore({ score }) {
  const getColor = (s) => {
    if (s >= 80) return COLORS.success;
    if (s >= 60) return COLORS.risk;
    return COLORS.danger;
  };
  const color = getColor(score);
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;

  return (
    <div style={{ position: "relative", width: 72, height: 72 }}>
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={radius} fill="none" stroke={COLORS.border} strokeWidth="4" />
        <circle
          cx="36" cy="36" r={radius} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={circumference} strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 11, color: COLORS.textMuted, fontWeight: 500, letterSpacing: 0.5 }}>B</span>
        <span style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{score}</span>
      </div>
    </div>
  );
}

function EngagementRing({ label, engaged, total, color }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? (engaged / total) * circumference : 0;
  const isEmpty = engaged === 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ position: "relative", width: 44, height: 44 }}>
        <svg width="44" height="44" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r={radius} fill="none" stroke={COLORS.border} strokeWidth="3" />
          <circle
            cx="22" cy="22" r={radius} fill="none" stroke={isEmpty ? COLORS.danger : color} strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={isEmpty ? 0 : circumference - progress}
            strokeLinecap="round" transform="rotate(-90 22 22)"
            opacity={isEmpty ? 0.3 : 1}
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 700, color: isEmpty ? COLORS.danger : color,
        }}>
          {engaged}/{total}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>{label}</div>
        <div style={{ fontSize: 11, color: isEmpty ? COLORS.danger : COLORS.textMuted }}>
          {isEmpty ? "None engaged" : `${engaged} engaged`}
        </div>
      </div>
    </div>
  );
}

function InsightCard({ icon, title, severity, children }) {
  const severityMap = {
    critical: { bg: COLORS.dangerBg, border: COLORS.dangerBorder, dot: COLORS.danger },
    warning: { bg: COLORS.riskBg, border: COLORS.riskBorder, dot: COLORS.risk },
    info: { bg: COLORS.accentGlow, border: "rgba(99,102,241,0.2)", dot: COLORS.accent },
  };
  const s = severityMap[severity] || severityMap.info;

  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12,
      padding: "16px 20px", flex: 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%", background: s.dot,
          boxShadow: `0 0 8px ${s.dot}`,
        }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: s.dot }}>
          {title}
        </span>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: COLORS.text }}>{children}</div>
    </div>
  );
}

function ExpandableSection({ title, badge, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12,
      overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", background: "none", border: "none", cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>{title}</span>
          {badge && (
            <span style={{
              fontSize: 11, fontWeight: 600, color: COLORS.textMuted, background: COLORS.border,
              padding: "2px 8px", borderRadius: 10,
            }}>{badge}</span>
          )}
        </div>
        <span style={{
          color: COLORS.textMuted, fontSize: 16, transition: "transform 0.2s",
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
        }}>▾</span>
      </button>
      {open && (
        <div style={{ padding: "0 20px 16px", borderTop: `1px solid ${COLORS.borderSubtle}` }}>
          {children}
        </div>
      )}
    </div>
  );
}

export default function DealDetailExecutive() {
  const dm = dealData.contacts.filter(c => c.role === "Decision Maker");
  const inf = dealData.contacts.filter(c => c.role === "Influencer");
  const eb = dealData.contacts.filter(c => c.role === "Economic Buyer");

  const aiSummary = `This $1.48M renewal is at significant risk despite an 85% CRM probability. Zero engagement has been detected across all 10 known contacts — including 4 decision makers and the economic buyer. There are no activity records, no conversation history, and no stage progression data. The B-score of 86.67 reflects strong deal fundamentals (size, stage, probability) but the complete absence of stakeholder engagement is a critical blindspot that the CRM probability alone does not capture.`;

  const font = "'DM Sans', system-ui, -apple-system, sans-serif";

  return (
    <div style={{
      minHeight: "100vh", background: COLORS.bg, fontFamily: font, color: COLORS.text,
      padding: "0",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet" />

      {/* Top Bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 32px", borderBottom: `1px solid ${COLORS.border}`,
        background: "rgba(18,20,26,0.8)", backdropFilter: "blur(20px)",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.textMuted }}>
          <span style={{ cursor: "pointer", color: COLORS.accent }}>Command Center</span>
          <span>›</span>
          <span style={{ cursor: "pointer", color: COLORS.accent }}>Deals</span>
          <span>›</span>
          <span style={{ color: COLORS.textDim, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {dealData.name}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: COLORS.textDim }}>Updated just now</span>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px 64px" }}>

        {/* ═══ TIER 1: Executive Summary ═══ */}
        <div style={{ marginBottom: 32 }}>
          {/* Deal Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 6, fontWeight: 500 }}>
                {dealData.account}
              </div>
              <h1 style={{
                fontSize: 22, fontWeight: 700, color: COLORS.text, margin: 0, lineHeight: 1.3,
                letterSpacing: "-0.01em",
              }}>
                {dealData.name}
              </h1>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 28, fontWeight: 700, color: COLORS.text,
                  fontFamily: "'JetBrains Mono', monospace", letterSpacing: "-0.02em",
                }}>
                  {dealData.amount}
                </span>
                <span style={{
                  fontSize: 12, fontWeight: 600, color: COLORS.accent,
                  background: COLORS.accentGlow, padding: "4px 12px", borderRadius: 6,
                  border: "1px solid rgba(99,102,241,0.2)",
                }}>
                  {dealData.stage}
                </span>
                <span style={{ fontSize: 12, color: COLORS.textMuted }}>
                  Close: {dealData.closeDate}
                </span>
                <span style={{ fontSize: 12, color: COLORS.textMuted }}>
                  Owner: {dealData.owner}
                </span>
              </div>
            </div>
            <BScore score={dealData.bScore} />
          </div>

          {/* AI Narrative — the hero */}
          <div style={{
            background: `linear-gradient(135deg, ${COLORS.surface} 0%, rgba(18,20,26,1) 100%)`,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 14, padding: "24px 28px",
            position: "relative", overflow: "hidden",
          }}>
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, height: 2,
              background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.risk}, ${COLORS.danger})`,
              opacity: 0.6,
            }} />
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 14,
            }}>
              <span style={{ fontSize: 14 }}>✦</span>
              <span style={{
                fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: 1.2, color: COLORS.textMuted,
              }}>
                AI Deal Intelligence
              </span>
            </div>
            <p style={{
              fontSize: 14, lineHeight: 1.75, color: COLORS.text, margin: 0,
              fontWeight: 400,
            }}>
              {aiSummary}
            </p>
          </div>
        </div>

        {/* ═══ TIER 2: Key Insights ═══ */}
        <div style={{ display: "flex", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
          <InsightCard icon="⚠" title="Single-Thread Risk" severity="critical">
            <strong>0 of 4 decision makers</strong> have been engaged. The economic buyer (Daryl Schofield, EVP Business Development) has had zero touchpoints. This deal is entirely single-threaded through the deal owner.
          </InsightCard>
          <InsightCard icon="📭" title="Activity Gap" severity="warning">
            <strong>No activity or conversations</strong> recorded in CRM or connected conversation tools. Unable to assess deal momentum or buyer sentiment.
          </InsightCard>
        </div>

        {/* Stakeholder Coverage Summary */}
        <div style={{
          background: COLORS.surface, border: `1px solid ${COLORS.border}`,
          borderRadius: 12, padding: "20px 24px", marginBottom: 24,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1,
            color: COLORS.textMuted, marginBottom: 16,
          }}>
            Stakeholder Coverage
          </div>
          <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
            <EngagementRing
              label="Decision Makers" engaged={0} total={dm.length}
              color={roleColors["Decision Maker"]}
            />
            <EngagementRing
              label="Economic Buyer" engaged={0} total={eb.length}
              color={roleColors["Economic Buyer"]}
            />
            <EngagementRing
              label="Influencers" engaged={0} total={inf.length}
              color={roleColors["Influencer"]}
            />
          </div>
        </div>

        {/* Recommended Actions */}
        <div style={{
          background: COLORS.surface, border: `1px solid ${COLORS.border}`,
          borderRadius: 12, padding: "20px 24px", marginBottom: 32,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1,
            color: COLORS.textMuted, marginBottom: 14,
          }}>
            Recommended Next Steps
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { priority: "P0", text: "Multi-thread into Ido Biger (CTO) and Daryl Schofield (EVP, Economic Buyer) — schedule introductory meetings this week", color: COLORS.danger },
              { priority: "P1", text: "Confirm deal is active with owner (steve.beitz) — zero CRM activity may indicate deal is being managed offline", color: COLORS.risk },
              { priority: "P2", text: "Request CRM stage history tracking to be enabled for pipeline visibility", color: COLORS.accent },
            ].map((action, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0",
                borderBottom: i < 2 ? `1px solid ${COLORS.borderSubtle}` : "none",
              }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: action.color,
                  background: `${action.color}15`, padding: "3px 8px", borderRadius: 4,
                  border: `1px solid ${action.color}30`, whiteSpace: "nowrap", marginTop: 1,
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {action.priority}
                </span>
                <span style={{ fontSize: 13, lineHeight: 1.5, color: COLORS.text }}>{action.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ═══ TIER 3: Drill-Down (Expandable) ═══ */}
        <div style={{
          fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1,
          color: COLORS.textDim, marginBottom: 12, paddingLeft: 4,
        }}>
          Details
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <ExpandableSection title="All Contacts" badge={`${dealData.contacts.length}`}>
            <div style={{ paddingTop: 12 }}>
              {dealData.contacts.map((c, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 0",
                  borderBottom: i < dealData.contacts.length - 1 ? `1px solid ${COLORS.borderSubtle}` : "none",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: "50%",
                      background: `${roleColors[c.role]}20`,
                      border: `1px solid ${roleColors[c.role]}40`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 700, color: roleColors[c.role],
                    }}>
                      {c.name.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: COLORS.textMuted }}>{c.title}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: roleColors[c.role],
                      background: `${roleColors[c.role]}15`, padding: "2px 8px", borderRadius: 4,
                      border: `1px solid ${roleColors[c.role]}25`,
                    }}>
                      {c.role}
                    </span>
                    <div style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: c.engaged ? COLORS.success : COLORS.danger,
                      opacity: 0.8,
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </ExpandableSection>

          <ExpandableSection title="Deal Metadata">
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 40px", paddingTop: 12,
            }}>
              {[
                ["Source", "Salesforce"],
                ["Pipeline", "—"],
                ["Probability", dealData.probability],
                ["Forecast", dealData.forecast],
                ["Close Date", dealData.closeDate],
                ["Created", "Jan 14, 2026"],
                ["Pandora Pipeline", "Unassigned"],
                ["Last Modified", "—"],
              ].map(([label, value], i) => (
                <div key={i}>
                  <div style={{ fontSize: 11, color: COLORS.textDim, marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
                  <div style={{ fontSize: 13, color: COLORS.text, fontWeight: 500 }}>{value}</div>
                </div>
              ))}
            </div>
          </ExpandableSection>

          <ExpandableSection title="Stage History">
            <div style={{ paddingTop: 12, fontSize: 13, color: COLORS.textMuted }}>
              Stage history not available — requires Salesforce field history tracking to be enabled.
            </div>
          </ExpandableSection>

          <ExpandableSection title="Score History">
            <div style={{ paddingTop: 12, fontSize: 13, color: COLORS.textMuted }}>
              No score history yet — history builds weekly after initial scoring.
            </div>
          </ExpandableSection>
        </div>

        {/* Floating Ask button */}
        <div style={{
          position: "fixed", bottom: 24, right: 24,
          background: COLORS.accent, color: "white",
          padding: "12px 20px", borderRadius: 50,
          fontSize: 13, fontWeight: 600, cursor: "pointer",
          boxShadow: `0 4px 24px rgba(99,102,241,0.4)`,
          display: "flex", alignItems: "center", gap: 8,
          transition: "transform 0.2s, box-shadow 0.2s",
        }}
          onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 6px 32px rgba(99,102,241,0.5)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 24px rgba(99,102,241,0.4)"; }}
        >
          💬 Ask about this deal
        </div>
      </div>
    </div>
  );
}
