import { useState } from "react";

const teal = "#2DD4BF";
const coral = "#F97316";
const bg = "#0D1117";
const surface = "#161B22";
const border = "#21262D";
const textPrimary = "#E6EDF3";
const textMuted = "#7D8590";
const textDim = "#484F58";

const categories = ["Pipeline", "Forecasting", "Reporting", "Intelligence", "Custom"];
const scheduleOptions = [
  { label: "On demand only", value: "on_demand" },
  { label: "Every Monday 8am", value: "0 8 * * 1" },
  { label: "Every Friday 4pm", value: "0 16 * * 5" },
  { label: "Monthly (1st)", value: "0 9 1 * *" },
];
const savedQueries = [
  { id: "q1", name: "Stalled deals > 21 days", returns: "deal_id, owner, days_stalled, amount, stage" },
  { id: "q2", name: "Rep pipeline by stage", returns: "owner_email, stage, deal_count, total_value" },
  { id: "q3", name: "Accounts with no activity 30d", returns: "account_id, name, last_activity_date, open_deals" },
  { id: "q4", name: "Deals missing close date", returns: "deal_id, name, stage, owner_email, created_at" },
];

const steps = ["Define", "Data", "Intelligence", "Review"];

export default function SkillBuilder() {
  const [activeStep, setActiveStep] = useState(1);
  const [skillName, setSkillName] = useState("");
  const [question, setQuestion] = useState("");
  const [category, setCategory] = useState("Pipeline");
  const [outputSlack, setOutputSlack] = useState(true);
  const [outputReport, setOutputReport] = useState(false);
  const [schedule, setSchedule] = useState("0 8 * * 1");
  const [selectedQuery, setSelectedQuery] = useState(null);
  const [sqlMode, setSqlMode] = useState(false);
  const [sql, setSql] = useState("");
  const [classifyEnabled, setClassifyEnabled] = useState(true);
  const [classifyBad, setClassifyBad] = useState("");
  const [classifyGood, setClassifyGood] = useState("");
  const [synthesizeEnabled, setSynthesizeEnabled] = useState(true);
  const [synthesizeTone, setSynthesizeTone] = useState("Flag risks");
  const [customPrompt, setCustomPrompt] = useState("");

  const queryObj = savedQueries.find(q => q.id === selectedQuery);

  const canAdvance = {
    1: skillName.length > 2 && question.length > 5,
    2: selectedQuery !== null || sql.length > 10,
    3: true,
    4: true,
  };

  return (
    <div style={{
      fontFamily: "'IBM Plex Sans', 'Outfit', system-ui, sans-serif",
      background: bg,
      minHeight: "100vh",
      color: textPrimary,
      padding: "32px 24px",
      boxSizing: "border-box",
    }}>
      {/* Header */}
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: `linear-gradient(135deg, ${teal}33, ${teal}11)`,
            border: `1px solid ${teal}44`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14,
          }}>⚡</div>
          <span style={{ fontSize: 12, color: textMuted, letterSpacing: "0.08em", textTransform: "uppercase" }}>Skill Builder</span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 4px", color: textPrimary }}>
          {skillName || "New Skill"}
        </h1>
        <p style={{ fontSize: 13, color: textMuted, margin: "0 0 32px" }}>
          Custom skills appear in the Skills library and are available to all Agents.
        </p>

        {/* Step nav */}
        <div style={{ display: "flex", gap: 0, marginBottom: 32, borderBottom: `1px solid ${border}` }}>
          {steps.map((s, i) => {
            const num = i + 1;
            const active = activeStep === num;
            const done = activeStep > num;
            return (
              <button key={s} onClick={() => done || active ? setActiveStep(num) : null}
                style={{
                  background: "none", border: "none", cursor: done ? "pointer" : "default",
                  padding: "10px 20px", fontSize: 13, fontWeight: active ? 600 : 400,
                  color: active ? teal : done ? textPrimary : textDim,
                  borderBottom: active ? `2px solid ${teal}` : "2px solid transparent",
                  marginBottom: -1, display: "flex", alignItems: "center", gap: 8,
                  transition: "color 0.15s",
                }}>
                <span style={{
                  width: 18, height: 18, borderRadius: "50%", fontSize: 10,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: active ? teal : done ? `${teal}22` : border,
                  color: active ? bg : done ? teal : textDim,
                  fontWeight: 700, flexShrink: 0,
                }}>{done ? "✓" : num}</span>
                {s}
              </button>
            );
          })}
        </div>

        {/* Step 1: Define */}
        {activeStep === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <Field label="Skill name" hint="Short, descriptive — appears in the Skills library">
              <input
                value={skillName}
                onChange={e => setSkillName(e.target.value)}
                placeholder="e.g. Renewal Risk Monitor"
                style={inputStyle}
              />
            </Field>

            <Field label="What question does this answer?" hint="This frames the Claude synthesis and appears as the skill description">
              <textarea
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder="e.g. Which renewal accounts show signs of churn risk based on engagement and deal activity?"
                rows={3}
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }}
              />
            </Field>

            <Field label="Category">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {categories.map(c => (
                  <button key={c} onClick={() => setCategory(c)} style={{
                    padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                    cursor: "pointer", transition: "all 0.15s",
                    background: category === c ? `${teal}22` : surface,
                    border: `1px solid ${category === c ? teal : border}`,
                    color: category === c ? teal : textMuted,
                  }}>{c}</button>
                ))}
              </div>
            </Field>

            <div style={{ display: "flex", gap: 24 }}>
              <Field label="Output" style={{ flex: 1 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <Toggle label="Slack summary" checked={outputSlack} onChange={setOutputSlack} />
                  <Toggle label="Full report (markdown)" checked={outputReport} onChange={setOutputReport} />
                </div>
              </Field>

              <Field label="Schedule" style={{ flex: 1 }}>
                <select value={schedule} onChange={e => setSchedule(e.target.value)} style={inputStyle}>
                  {scheduleOptions.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        )}

        {/* Step 2: Data */}
        {activeStep === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <TabBtn active={!sqlMode} onClick={() => setSqlMode(false)}>Saved queries</TabBtn>
              <TabBtn active={sqlMode} onClick={() => setSqlMode(true)}>Write SQL</TabBtn>
            </div>

            {!sqlMode ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={{ fontSize: 12, color: textMuted, margin: 0 }}>
                  Select a saved query as the data source for this skill.
                </p>
                {savedQueries.map(q => (
                  <button key={q.id} onClick={() => setSelectedQuery(q.id)} style={{
                    background: selectedQuery === q.id ? `${teal}0D` : surface,
                    border: `1px solid ${selectedQuery === q.id ? teal : border}`,
                    borderRadius: 8, padding: "12px 16px", cursor: "pointer",
                    textAlign: "left", transition: "all 0.15s",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: selectedQuery === q.id ? teal : textPrimary }}>
                        {q.name}
                      </span>
                      {selectedQuery === q.id && (
                        <span style={{ fontSize: 10, background: `${teal}22`, color: teal, padding: "2px 8px", borderRadius: 4 }}>Selected</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: textDim, marginTop: 4, fontFamily: "monospace" }}>
                      returns: {q.returns}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 12, color: textMuted, margin: "0 0 10px" }}>
                  Write a SQL query against your workspace data. Always include <code style={{ color: teal }}>workspace_id = $1</code>.
                </p>
                <textarea
                  value={sql}
                  onChange={e => setSql(e.target.value)}
                  placeholder={"SELECT d.id, d.name, d.owner_email, d.amount, d.close_date\nFROM deals d\nWHERE workspace_id = $1\n  AND stage NOT IN ('closed_won','closed_lost')\n  AND close_date < NOW()"}
                  rows={8}
                  style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12, lineHeight: 1.7, resize: "vertical" }}
                />
              </div>
            )}

            {/* Preview */}
            {(queryObj || sql.length > 10) && (
              <div style={{ background: `${teal}08`, border: `1px solid ${teal}22`, borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ fontSize: 11, color: teal, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                  Data preview
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  {(queryObj?.returns || "deal_id, owner, amount").split(", ").map(col => (
                    <div key={col} style={{
                      fontSize: 11, fontFamily: "monospace",
                      background: surface, border: `1px solid ${border}`,
                      padding: "3px 8px", borderRadius: 4, color: textMuted,
                    }}>{col.trim()}</div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: textDim, marginTop: 10 }}>
                  ✓ Workspace isolation enforced · Row limit: 500 · Token budget: ~1,200
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Intelligence */}
        {activeStep === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Classify */}
            <div style={{
              border: `1px solid ${classifyEnabled ? `${teal}44` : border}`,
              borderRadius: 10, overflow: "hidden",
              transition: "border-color 0.2s",
            }}>
              <div style={{
                padding: "14px 18px",
                background: classifyEnabled ? `${teal}08` : surface,
                display: "flex", justifyContent: "space-between", alignItems: "center",
                cursor: "pointer",
              }} onClick={() => setClassifyEnabled(!classifyEnabled)}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: classifyEnabled ? teal : textPrimary }}>
                    Classify with AI
                  </div>
                  <div style={{ fontSize: 12, color: textMuted, marginTop: 2 }}>
                    DeepSeek labels each row before Claude synthesizes — keeps costs low
                  </div>
                </div>
                <Switch on={classifyEnabled} />
              </div>
              {classifyEnabled && (
                <div style={{ padding: "16px 18px", borderTop: `1px solid ${border}`, display: "flex", flexDirection: "column", gap: 14 }}>
                  <Field label='What does "bad" look like?' hint="Plain English — the AI translates this to classification rules">
                    <input value={classifyBad} onChange={e => setClassifyBad(e.target.value)}
                      placeholder="e.g. No activity in 30+ days, champion has left, or deal is past close date"
                      style={inputStyle} />
                  </Field>
                  <Field label='What does "good" look like?'>
                    <input value={classifyGood} onChange={e => setClassifyGood(e.target.value)}
                      placeholder="e.g. Recent multi-threaded engagement, deal advancing on schedule"
                      style={inputStyle} />
                  </Field>
                </div>
              )}
            </div>

            {/* Synthesize */}
            <div style={{
              border: `1px solid ${synthesizeEnabled ? `${coral}44` : border}`,
              borderRadius: 10, overflow: "hidden",
              transition: "border-color 0.2s",
            }}>
              <div style={{
                padding: "14px 18px",
                background: synthesizeEnabled ? `${coral}08` : surface,
                display: "flex", justifyContent: "space-between", alignItems: "center",
                cursor: "pointer",
              }} onClick={() => setSynthesizeEnabled(!synthesizeEnabled)}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: synthesizeEnabled ? coral : textPrimary }}>
                    Synthesize with Claude
                  </div>
                  <div style={{ fontSize: 12, color: textMuted, marginTop: 2 }}>
                    Generates a narrative report with findings and recommended actions
                  </div>
                </div>
                <Switch on={synthesizeEnabled} color={coral} />
              </div>
              {synthesizeEnabled && (
                <div style={{ padding: "16px 18px", borderTop: `1px solid ${border}`, display: "flex", flexDirection: "column", gap: 14 }}>
                  <Field label="Tone / focus">
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {["Flag risks", "Highlight opportunities", "Weekly summary", "Custom"].map(t => (
                        <button key={t} onClick={() => setSynthesizeTone(t)} style={{
                          padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                          cursor: "pointer", transition: "all 0.15s",
                          background: synthesizeTone === t ? `${coral}22` : surface,
                          border: `1px solid ${synthesizeTone === t ? coral : border}`,
                          color: synthesizeTone === t ? coral : textMuted,
                        }}>{t}</button>
                      ))}
                    </div>
                  </Field>
                  {synthesizeTone === "Custom" && (
                    <Field label="Custom synthesis instruction">
                      <textarea value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
                        placeholder="e.g. For each account, explain the renewal risk in one sentence and recommend a specific action for the CSM."
                        rows={3} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
                    </Field>
                  )}
                </div>
              )}
            </div>

            {/* Cost estimate */}
            <div style={{
              background: surface, border: `1px solid ${border}`,
              borderRadius: 8, padding: "12px 16px",
              display: "flex", gap: 24, flexWrap: "wrap",
            }}>
              <CostStat label="Est. tokens / run" value={classifyEnabled && synthesizeEnabled ? "~4,800" : synthesizeEnabled ? "~3,200" : "~800"} />
              <CostStat label="Est. cost / run" value={classifyEnabled && synthesizeEnabled ? "~$0.07" : synthesizeEnabled ? "~$0.04" : "~$0.01"} />
              <CostStat label="Monthly (weekly schedule)" value={classifyEnabled && synthesizeEnabled ? "~$0.28" : "~$0.16"} />
            </div>
          </div>
        )}

        {/* Step 4: Review */}
        {activeStep === 4 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: 10, padding: 20 }}>
              <div style={{ fontSize: 11, color: textMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>Skill summary</div>

              <ReviewRow label="Name" value={skillName || "—"} />
              <ReviewRow label="Question" value={question || "—"} />
              <ReviewRow label="Category" value={category} />
              <ReviewRow label="Schedule" value={scheduleOptions.find(s => s.value === schedule)?.label} />
              <ReviewRow label="Output" value={[outputSlack && "Slack", outputReport && "Report"].filter(Boolean).join(" + ") || "None"} />
              <ReviewRow label="Data source" value={queryObj?.name || (sql ? "Custom SQL" : "—")} />
              <ReviewRow label="Classify" value={classifyEnabled ? "DeepSeek · enabled" : "Disabled"} />
              <ReviewRow label="Synthesize" value={synthesizeEnabled ? `Claude · ${synthesizeTone}` : "Disabled"} />
            </div>

            <div style={{
              background: `${teal}08`, border: `1px solid ${teal}22`,
              borderRadius: 8, padding: "12px 16px", fontSize: 12, color: textMuted, lineHeight: 1.6,
            }}>
              ✓ This skill will appear in the <strong style={{ color: textPrimary }}>Skills library</strong> with a Custom badge.<br />
              ✓ All Agents can be configured to call it from their skill palette.<br />
              ✓ You can edit or delete it at any time from the library.
            </div>
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 32, paddingTop: 20, borderTop: `1px solid ${border}` }}>
          <button onClick={() => setActiveStep(s => Math.max(1, s - 1))}
            style={{
              ...btnStyle, background: "none",
              border: `1px solid ${border}`, color: textMuted,
              visibility: activeStep === 1 ? "hidden" : "visible",
            }}>
            ← Back
          </button>
          {activeStep < 4 ? (
            <button
              onClick={() => canAdvance[activeStep] && setActiveStep(s => s + 1)}
              style={{
                ...btnStyle,
                background: canAdvance[activeStep] ? teal : border,
                color: canAdvance[activeStep] ? bg : textDim,
                cursor: canAdvance[activeStep] ? "pointer" : "not-allowed",
              }}>
              Continue →
            </button>
          ) : (
            <button style={{ ...btnStyle, background: teal, color: bg }}>
              ⚡ Create Skill
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children, style }) {
  return (
    <div style={style}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </label>
      {hint && <p style={{ fontSize: 11, color: textDim, margin: "0 0 8px", lineHeight: 1.5 }}>{hint}</p>}
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => onChange(!checked)}>
      <Switch on={checked} small />
      <span style={{ fontSize: 13, color: checked ? textPrimary : textMuted }}>{label}</span>
    </div>
  );
}

function Switch({ on, color = teal, small }) {
  const w = small ? 28 : 36;
  const h = small ? 16 : 20;
  const d = small ? 12 : 16;
  return (
    <div style={{
      width: w, height: h, borderRadius: h, flexShrink: 0,
      background: on ? color : border,
      position: "relative", transition: "background 0.2s",
    }}>
      <div style={{
        width: d, height: d, borderRadius: "50%", background: on ? bg : textDim,
        position: "absolute", top: (h - d) / 2,
        left: on ? w - d - (h - d) / 2 : (h - d) / 2,
        transition: "left 0.2s",
      }} />
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500,
      cursor: "pointer", border: `1px solid ${active ? teal : border}`,
      background: active ? `${teal}22` : surface,
      color: active ? teal : textMuted,
    }}>{children}</button>
  );
}

function CostStat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: textDim, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: textPrimary }}>{value}</div>
    </div>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${border}`, fontSize: 13 }}>
      <span style={{ color: textMuted }}>{label}</span>
      <span style={{ color: textPrimary, fontWeight: 500, textAlign: "right", maxWidth: "60%" }}>{value}</span>
    </div>
  );
}

const inputStyle = {
  width: "100%", background: surface, border: `1px solid ${border}`,
  borderRadius: 6, padding: "9px 12px", fontSize: 13, color: textPrimary,
  outline: "none", boxSizing: "border-box",
  fontFamily: "inherit",
};

const btnStyle = {
  padding: "9px 20px", borderRadius: 7, fontSize: 13, fontWeight: 600,
  cursor: "pointer", border: "none", transition: "all 0.15s",
};
