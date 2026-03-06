import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';

const teal = '#2DD4BF';
const coral = '#F97316';
const bg = '#0D1117';
const surface = '#161B22';
const border = '#21262D';
const textPrimary = '#E6EDF3';
const textMuted = '#7D8590';
const textDim = '#484F58';
const accent = '#2DD4BF';

const categories = ['Pipeline', 'Forecasting', 'Reporting', 'Intelligence', 'Custom'];

const scheduleOptions = [
  { label: 'On demand only', value: '' },
  { label: 'Every Monday 8am', value: '0 8 * * 1' },
  { label: 'Every Friday 4pm', value: '0 16 * * 5' },
  { label: 'Monthly (1st)', value: '0 9 1 * *' },
];

const tones = ['Flag risks', 'Highlight opportunities', 'Weekly summary', 'Custom'];

const steps = ['Define', 'Data', 'Intelligence', 'Review'];

interface SavedQuery {
  id: string;
  name: string;
  sql_text?: string;
  description?: string;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: surface,
  border: `1px solid ${border}`,
  borderRadius: 8,
  padding: '9px 12px',
  color: textPrimary,
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};

function Field({ label, hint, children, style }: { label: string; hint?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: textPrimary }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: textMuted, marginTop: 1 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: textPrimary }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 34, height: 18, borderRadius: 9,
          background: checked ? teal : border,
          position: 'relative', transition: 'background 0.2s', flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute', top: 2, left: checked ? 16 : 2, width: 14, height: 14,
          borderRadius: '50%', background: '#fff',
          transition: 'left 0.2s',
        }} />
      </div>
      {label}
    </label>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <div style={{
      width: 34, height: 18, borderRadius: 9,
      background: on ? teal : border,
      position: 'relative', flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', top: 2, left: on ? 16 : 2, width: 14, height: 14,
        borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
      }} />
    </div>
  );
}

function CostBar({ classifyEnabled, synthesizeEnabled }: { classifyEnabled: boolean; synthesizeEnabled: boolean }) {
  const tokensPerRun = (classifyEnabled ? 800 : 0) + (synthesizeEnabled ? 1200 : 0) + 200;
  const costPerRun = ((classifyEnabled ? 0.0002 : 0) + (synthesizeEnabled ? 0.006 : 0)).toFixed(4);
  return (
    <div style={{ background: `${teal}08`, border: `1px solid ${teal}22`, borderRadius: 8, padding: '10px 14px', fontSize: 11, color: textMuted, display: 'flex', gap: 20 }}>
      <span>Est. <strong style={{ color: textPrimary }}>{tokensPerRun.toLocaleString()}</strong> tokens/run</span>
      <span>Est. <strong style={{ color: textPrimary }}>${costPerRun}</strong>/run</span>
      <span>{classifyEnabled || synthesizeEnabled ? 'AI analysis enabled' : 'Data-only (no AI cost)'}</span>
    </div>
  );
}

interface Props {
  editMode?: boolean;
}

export default function SkillBuilder({ editMode }: Props) {
  const navigate = useNavigate();
  const params = useParams<{ skillId?: string }>();
  const skillId = params.skillId;

  const [activeStep, setActiveStep] = useState(1);
  const [skillName, setSkillName] = useState('');
  const [question, setQuestion] = useState('');
  const [category, setCategory] = useState('Pipeline');
  const [outputSlack, setOutputSlack] = useState(true);
  const [outputReport, setOutputReport] = useState(false);
  const [schedule, setSchedule] = useState('');

  const [sqlMode, setSqlMode] = useState(false);
  const [selectedQueryId, setSelectedQueryId] = useState<string | null>(null);
  const [selectedQueryName, setSelectedQueryName] = useState('');
  const [sql, setSql] = useState('');
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [loadingQueries, setLoadingQueries] = useState(false);

  const [classifyEnabled, setClassifyEnabled] = useState(true);
  const [classifyBad, setClassifyBad] = useState('');
  const [classifyGood, setClassifyGood] = useState('');
  const [synthesizeEnabled, setSynthesizeEnabled] = useState(true);
  const [synthesizeTone, setSynthesizeTone] = useState('Flag risks');
  const [customPrompt, setCustomPrompt] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (activeStep === 2) {
      setLoadingQueries(true);
      api.get('/sql/saved')
        .then((d: any) => setSavedQueries(Array.isArray(d) ? d : (d?.queries || [])))
        .catch(() => setSavedQueries([]))
        .finally(() => setLoadingQueries(false));
    }
  }, [activeStep]);

  useEffect(() => {
    if (editMode && skillId) {
      api.get(`/skills/custom`)
        .then((d: any) => {
          const row = (d?.skills || []).find((s: any) => s.skill_id === skillId);
          if (row) {
            setSkillName(row.name);
            setQuestion(row.description);
            setCategory(row.category ? row.category.charAt(0).toUpperCase() + row.category.slice(1) : 'Custom');
            setOutputSlack(row.output_slack);
            setOutputReport(row.output_report);
            setSchedule(row.schedule_cron || '');
            setSqlMode(row.query_source === 'inline_sql');
            setSelectedQueryId(row.saved_query_id || null);
            setSelectedQueryName(row.saved_query_name || '');
            setSql(row.inline_sql || '');
            setClassifyEnabled(row.classify_enabled);
            setClassifyBad(row.classify_bad || '');
            setClassifyGood(row.classify_good || '');
            setSynthesizeEnabled(row.synthesize_enabled);
            setSynthesizeTone(row.synthesize_tone || 'Flag risks');
            setCustomPrompt(row.synthesize_custom_prompt || '');
          }
        })
        .catch(() => {});
    }
  }, [editMode, skillId]);

  const canAdvance: Record<number, boolean> = {
    1: skillName.length >= 3 && question.length >= 5,
    2: !sqlMode ? selectedQueryId !== null : sql.length > 10,
    3: true,
    4: true,
  };

  const inferColumns = (sqlText: string): string[] => {
    const m = sqlText.match(/SELECT\s+([\s\S]+?)\s+FROM/i);
    if (!m) return [];
    return m[1].split(',').map(c => {
      const alias = c.match(/(?:AS\s+)?(\w+)\s*$/i);
      return alias ? alias[1].trim() : c.trim().split(/\s+/).pop() || c.trim();
    }).filter(Boolean).slice(0, 8);
  };

  const selectedQuery = savedQueries.find(q => q.id === selectedQueryId);
  const previewColumns = sqlMode ? inferColumns(sql) : (selectedQuery ? inferColumns(selectedQuery.sql_text || '') : []);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError('');
    try {
      const payload = {
        name: skillName,
        description: question,
        category: category.toLowerCase(),
        query_source: sqlMode ? 'inline_sql' : 'saved_query',
        saved_query_id: sqlMode ? null : selectedQueryId,
        saved_query_name: sqlMode ? null : selectedQueryName,
        inline_sql: sqlMode ? sql : null,
        classify_enabled: classifyEnabled,
        classify_bad: classifyEnabled ? classifyBad : null,
        classify_good: classifyEnabled ? classifyGood : null,
        synthesize_enabled: synthesizeEnabled,
        synthesize_tone: synthesizeTone,
        synthesize_custom_prompt: synthesizeTone === 'Custom' ? customPrompt : null,
        output_slack: outputSlack,
        output_report: outputReport,
        schedule_cron: schedule || null,
      };

      if (editMode && skillId) {
        await api.put(`/skills/custom/${skillId}`, payload);
      } else {
        await api.post('/skills/custom', payload);
      }

      navigate('/skills');
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to save skill');
    } finally {
      setSubmitting(false);
    }
  }, [skillName, question, category, sqlMode, selectedQueryId, selectedQueryName, sql, classifyEnabled, classifyBad, classifyGood, synthesizeEnabled, synthesizeTone, customPrompt, outputSlack, outputReport, schedule, editMode, skillId, navigate]);

  return (
    <div style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif", background: bg, minHeight: '100vh', color: textPrimary, padding: '32px 24px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: `linear-gradient(135deg, ${teal}33, ${teal}11)`,
            border: `1px solid ${teal}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
          }}>⚡</div>
          <span style={{ fontSize: 12, color: textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Skill Builder
          </span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px', color: textPrimary }}>
          {skillName || (editMode ? 'Edit Skill' : 'New Skill')}
        </h1>
        <p style={{ fontSize: 13, color: textMuted, margin: '0 0 32px' }}>
          Custom skills appear in the Skills library and are available to all Agents.
        </p>

        {/* Step nav */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 32, borderBottom: `1px solid ${border}` }}>
          {steps.map((s, i) => {
            const num = i + 1;
            const active = activeStep === num;
            const done = activeStep > num;
            return (
              <button
                key={s}
                onClick={() => (done ? setActiveStep(num) : undefined)}
                style={{
                  background: 'none', border: 'none',
                  cursor: done ? 'pointer' : 'default',
                  padding: '10px 20px', fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  color: active ? teal : done ? textPrimary : textDim,
                  borderBottom: active ? `2px solid ${teal}` : '2px solid transparent',
                  marginBottom: -1,
                  display: 'flex', alignItems: 'center', gap: 8,
                  transition: 'color 0.15s',
                }}
              >
                <span style={{
                  width: 18, height: 18, borderRadius: '50%', fontSize: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: active ? teal : done ? `${teal}22` : border,
                  color: active ? bg : done ? teal : textDim,
                  fontWeight: 700, flexShrink: 0,
                }}>
                  {done ? '✓' : num}
                </span>
                {s}
              </button>
            );
          })}
        </div>

        {/* Step 1: Define */}
        {activeStep === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
              />
            </Field>

            <Field label="Category">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {categories.map(c => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    style={{
                      padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                      cursor: 'pointer', transition: 'all 0.15s',
                      background: category === c ? `${teal}22` : surface,
                      border: `1px solid ${category === c ? teal : border}`,
                      color: category === c ? teal : textMuted,
                    }}
                  >{c}</button>
                ))}
              </div>
            </Field>

            <div style={{ display: 'flex', gap: 24 }}>
              <Field label="Output" style={{ flex: 1 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Toggle label="Slack summary" checked={outputSlack} onChange={setOutputSlack} />
                  <Toggle label="Full report (markdown)" checked={outputReport} onChange={setOutputReport} />
                </div>
              </Field>

              <Field label="Schedule" style={{ flex: 1 }}>
                <select
                  value={schedule}
                  onChange={e => setSchedule(e.target.value)}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {['Saved queries', 'Write SQL'].map((tab, i) => {
                const isActive = (i === 0) === !sqlMode;
                return (
                  <button
                    key={tab}
                    onClick={() => setSqlMode(i === 1)}
                    style={{
                      padding: '7px 16px', borderRadius: '6px 6px 0 0',
                      background: isActive ? surface : 'transparent',
                      border: `1px solid ${isActive ? border : 'transparent'}`,
                      borderBottom: isActive ? `1px solid ${surface}` : `1px solid ${border}`,
                      color: isActive ? textPrimary : textMuted,
                      fontSize: 13, fontWeight: isActive ? 600 : 400, cursor: 'pointer',
                    }}
                  >{tab}</button>
                );
              })}
            </div>

            <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: '0 8px 8px 8px', padding: 20 }}>
              {!sqlMode ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{ fontSize: 12, color: textMuted, margin: '0 0 8px' }}>
                    Select a saved query as the data source for this skill.
                  </p>
                  {loadingQueries ? (
                    <div style={{ color: textMuted, fontSize: 13, padding: '12px 0' }}>Loading queries…</div>
                  ) : savedQueries.length === 0 ? (
                    <div style={{ color: textMuted, fontSize: 13, padding: '12px 0' }}>
                      No saved queries found. Use the SQL Explorer to save a query first, or switch to "Write SQL".
                    </div>
                  ) : (
                    savedQueries.map(q => (
                      <button
                        key={q.id}
                        onClick={() => { setSelectedQueryId(q.id); setSelectedQueryName(q.name); }}
                        style={{
                          background: selectedQueryId === q.id ? `${teal}0D` : 'transparent',
                          border: `1px solid ${selectedQueryId === q.id ? teal : border}`,
                          borderRadius: 8, padding: '12px 16px', cursor: 'pointer',
                          textAlign: 'left', transition: 'all 0.15s',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: selectedQueryId === q.id ? teal : textPrimary }}>
                            {q.name}
                          </span>
                          {selectedQueryId === q.id && (
                            <span style={{ fontSize: 10, background: `${teal}22`, color: teal, padding: '2px 8px', borderRadius: 4 }}>
                              Selected
                            </span>
                          )}
                        </div>
                        {q.description && (
                          <div style={{ fontSize: 11, color: textMuted, marginTop: 4 }}>{q.description}</div>
                        )}
                        {q.sql_text && (
                          <div style={{ fontSize: 10, color: textDim, marginTop: 4, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {q.sql_text.slice(0, 80)}…
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 12, color: textMuted, margin: '0 0 10px' }}>
                    Write a SQL query against your workspace data. Always include{' '}
                    <code style={{ color: teal, fontSize: 11 }}>workspace_id = $1</code> for data isolation.
                  </p>
                  <textarea
                    value={sql}
                    onChange={e => setSql(e.target.value)}
                    placeholder={'SELECT d.id, d.name, d.owner_email, d.amount, d.close_date\nFROM deals d\nWHERE workspace_id = $1\n  AND stage NOT IN (\'closed_won\',\'closed_lost\')\n  AND close_date < NOW()'}
                    rows={8}
                    style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7, resize: 'vertical' }}
                  />
                </div>
              )}
            </div>

            {/* Data preview */}
            {(selectedQueryId || sql.length > 10) && (
              <div style={{ background: `${teal}08`, border: `1px solid ${teal}22`, borderRadius: 8, padding: '14px 16px' }}>
                <div style={{ fontSize: 11, color: teal, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                  Data preview
                </div>
                {previewColumns.length > 0 ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {previewColumns.map(col => (
                      <div
                        key={col}
                        style={{ fontSize: 11, fontFamily: 'monospace', background: surface, border: `1px solid ${border}`, padding: '3px 8px', borderRadius: 4, color: textMuted }}
                      >
                        {col}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: textMuted }}>Columns will be inferred at runtime</div>
                )}
                <div style={{ fontSize: 11, color: textDim, marginTop: 10 }}>
                  ✓ Workspace isolation enforced · Row limit: 500 · Token budget: ~1,200
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Intelligence */}
        {activeStep === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Classify panel */}
            <div style={{ border: `1px solid ${classifyEnabled ? `${teal}44` : border}`, borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.2s' }}>
              <div
                style={{ padding: '14px 18px', background: classifyEnabled ? `${teal}08` : surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                onClick={() => setClassifyEnabled(!classifyEnabled)}
              >
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
                <div style={{ padding: '16px 18px', borderTop: `1px solid ${border}`, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <Field label="What does bad look like?" hint="Plain English — e.g. 'No activity in 21+ days and deal is in Proposal stage'">
                    <input
                      value={classifyBad}
                      onChange={e => setClassifyBad(e.target.value)}
                      placeholder="e.g. No activity in 21+ days, missing close date, or single-threaded"
                      style={inputStyle}
                    />
                  </Field>
                  <Field label="What does good look like?" hint="e.g. 'Active engagement, multiple stakeholders, close date within 30 days'">
                    <input
                      value={classifyGood}
                      onChange={e => setClassifyGood(e.target.value)}
                      placeholder="e.g. Recent activity, multi-threaded, clear next steps"
                      style={inputStyle}
                    />
                  </Field>
                </div>
              )}
            </div>

            {/* Synthesize panel */}
            <div style={{ border: `1px solid ${synthesizeEnabled ? `${coral}44` : border}`, borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.2s' }}>
              <div
                style={{ padding: '14px 18px', background: synthesizeEnabled ? `${coral}08` : surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                onClick={() => setSynthesizeEnabled(!synthesizeEnabled)}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: synthesizeEnabled ? coral : textPrimary }}>
                    Synthesize with Claude
                  </div>
                  <div style={{ fontSize: 12, color: textMuted, marginTop: 2 }}>
                    Generates a narrative report with findings and recommended actions
                  </div>
                </div>
                <div style={{ width: 34, height: 18, borderRadius: 9, background: synthesizeEnabled ? coral : border, position: 'relative', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 2, left: synthesizeEnabled ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                </div>
              </div>
              {synthesizeEnabled && (
                <div style={{ padding: '16px 18px', borderTop: `1px solid ${border}`, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <Field label="Tone">
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {tones.map(t => (
                        <button
                          key={t}
                          onClick={() => setSynthesizeTone(t)}
                          style={{
                            padding: '6px 12px', borderRadius: 6, fontSize: 12,
                            cursor: 'pointer', transition: 'all 0.15s',
                            background: synthesizeTone === t ? `${coral}22` : surface,
                            border: `1px solid ${synthesizeTone === t ? coral : border}`,
                            color: synthesizeTone === t ? coral : textMuted,
                          }}
                        >{t}</button>
                      ))}
                    </div>
                  </Field>
                  {synthesizeTone === 'Custom' && (
                    <Field label="Custom instruction">
                      <textarea
                        value={customPrompt}
                        onChange={e => setCustomPrompt(e.target.value)}
                        placeholder="You are a revenue analyst. Your goal is to..."
                        rows={4}
                        style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
                      />
                    </Field>
                  )}
                </div>
              )}
            </div>

            <CostBar classifyEnabled={classifyEnabled} synthesizeEnabled={synthesizeEnabled} />
          </div>
        )}

        {/* Step 4: Review */}
        {activeStep === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
              {[
                ['Skill name', skillName],
                ['Description', question],
                ['Category', category],
                ['Data source', sqlMode ? 'Inline SQL' : `Saved query: ${selectedQueryName}`],
                ['Classify with AI', classifyEnabled ? `Yes — ${classifyBad || 'any risk pattern'}` : 'Disabled'],
                ['Synthesize with Claude', synthesizeEnabled ? `Yes — ${synthesizeTone}` : 'Disabled'],
                ['Slack output', outputSlack ? 'Enabled' : 'Disabled'],
                ['Schedule', scheduleOptions.find(o => o.value === schedule)?.label || 'On demand only'],
              ].map(([k, v], i, arr) => (
                <div
                  key={k}
                  style={{
                    display: 'flex', gap: 16, padding: '11px 16px',
                    borderBottom: i < arr.length - 1 ? `1px solid ${border}` : 'none',
                  }}
                >
                  <div style={{ fontSize: 12, color: textMuted, width: 140, flexShrink: 0 }}>{k}</div>
                  <div style={{ fontSize: 12, color: textPrimary, flex: 1 }}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{ background: `${teal}08`, border: `1px solid ${teal}22`, borderRadius: 8, padding: '14px 16px', fontSize: 12, color: textMuted, lineHeight: 1.6 }}>
              This skill will appear in the Skills library with a <strong style={{ color: teal }}>Custom</strong> badge. All Agents can be configured to call it. You can edit or delete it at any time.
            </div>

            {submitError && (
              <div style={{ background: '#f9191911', border: '1px solid #f91919', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#f87171' }}>
                {submitError}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                padding: '11px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600,
                background: submitting ? `${teal}66` : teal,
                color: bg, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer',
                alignSelf: 'flex-start', transition: 'background 0.15s',
              }}
            >
              {submitting ? 'Creating…' : editMode ? 'Save Changes' : 'Create Skill'}
            </button>
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 40 }}>
          <button
            onClick={() => activeStep > 1 ? setActiveStep(s => s - 1) : navigate('/skills')}
            style={{ padding: '8px 18px', borderRadius: 8, fontSize: 13, background: 'transparent', color: textMuted, border: `1px solid ${border}`, cursor: 'pointer' }}
          >
            {activeStep === 1 ? '← Back to Skills' : '← Back'}
          </button>
          {activeStep < 4 && (
            <button
              onClick={() => setActiveStep(s => s + 1)}
              disabled={!canAdvance[activeStep]}
              style={{
                padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: canAdvance[activeStep] ? teal : `${teal}33`,
                color: canAdvance[activeStep] ? bg : textDim,
                border: 'none', cursor: canAdvance[activeStep] ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s',
              }}
            >
              Continue →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
