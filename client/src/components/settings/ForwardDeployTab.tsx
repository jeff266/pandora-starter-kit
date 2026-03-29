import React, { useState, useEffect, useCallback, useRef } from 'react';
import { colors, fonts } from '../../styles/theme';
import { useWorkspace } from '../../context/WorkspaceContext';
import { api } from '../../lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface WIReadiness {
  overall_score: number;
  by_domain: Record<string, { total: number; confirmed: number; inferred: number; score: number }>;
  blocking_gaps: Array<{ question_id: string; domain: string; label: string }>;
  skill_gates: Array<{ skill_id: string; skill_name: string; status: 'LIVE' | 'DRAFT' | 'BLOCKED'; missing_items: string[] }>;
}

interface WI {
  identity?: { workspace_name?: string; crm_type?: string };
  pipeline?: { active_stages?: Array<{ name: string }> };
  readiness: WIReadiness;
  metrics: Record<string, {
    label: string; unit: string; confidence: string;
    last_computed_value: number | null; confirmed_value: number | null;
  }>;
}

interface CalibrationQuestion {
  question_id: string;
  question: string;
  description: string;
  answer_type: 'text' | 'select' | 'multiselect' | 'boolean' | 'number' | 'field_picker' | 'stage_picker';
  options: string[];
  status: 'CONFIRMED' | 'INFERRED' | 'UNKNOWN' | 'BLOCKED';
  answer: { value: any } | null;
  answer_source: string | null;
  required_for_live: boolean;
  skill_dependencies: string[];
  depends_on: string[];
  human_confirmed: boolean;
}

interface DomainData {
  score: number; total: number; confirmed: number; inferred: number; unknown: number;
  questions: CalibrationQuestion[];
}

interface CalibrationData {
  overall_score: number;
  domains: Record<string, DomainData>;
}

interface MetricItem {
  metric_key: string; label: string; unit: string;
  confidence: string; last_computed_value: number | null; confirmed_value: number | null;
}

type Phase = 1 | 2 | 3 | 4 | 5;

const DOMAIN_LABELS: Record<string, string> = {
  pipeline: 'Pipeline', segmentation: 'Segmentation', taxonomy: 'Taxonomy',
  metrics: 'Metrics', business: 'Business', data_quality: 'Data Quality',
};

const DOMAIN_ORDER = ['pipeline', 'segmentation', 'taxonomy', 'metrics', 'business', 'data_quality'];

const PHASE_LABELS = ['Ingest', 'Checklist', 'Confirm', 'Lock', 'Infuse'];

// ─── Small helpers ────────────────────────────────────────────────────────────

function formatValue(val: any, unit?: string): string {
  if (val === null || val === undefined) return '—';
  if (unit === 'percentage') return `${(val * 100).toFixed(1)}%`;
  if (unit === 'currency') return `$${Number(val).toLocaleString()}`;
  if (unit === 'days') return `${val} days`;
  if (unit === 'ratio') return `${(val * 100).toFixed(1)}%`;
  return String(val);
}

function StatusDot({ status }: { status: 'LIVE' | 'DRAFT' | 'BLOCKED' }) {
  const cfg = {
    LIVE:    { color: colors.green,  label: 'LIVE' },
    DRAFT:   { color: colors.yellow, label: 'DRAFT' },
    BLOCKED: { color: colors.red,    label: 'BLOCKED' },
  }[status];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
    </span>
  );
}

function ProgressBar({ value, color = colors.accent }: { value: number; color?: string }) {
  return (
    <div style={{ height: 6, background: colors.border, borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(100, value)}%`, background: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
    </div>
  );
}

function Toast({ msg, type, onClose }: { msg: string; type: 'error' | 'success'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: type === 'error' ? colors.redSoft : colors.greenSoft,
      border: `1px solid ${type === 'error' ? colors.red : colors.green}`,
      color: type === 'error' ? colors.red : colors.green,
      padding: '12px 18px', borderRadius: 8, fontSize: 13, fontFamily: fonts.sans,
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)', maxWidth: 360,
    }}>
      {msg}
    </div>
  );
}

// ─── Phase 1: Ingest ─────────────────────────────────────────────────────────

function Phase1Ingest({ wi, calibration, onJumpToQuestion }: {
  wi: WI | null;
  calibration: CalibrationData | null;
  onJumpToQuestion: (questionId: string) => void;
}) {
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState(false);

  const crmType = wi?.identity?.crm_type ?? 'CRM';
  const activeStages = wi?.pipeline?.active_stages ?? [];

  // Look up stage_history_tracked directly from calibration data
  const stageHistoryQ = calibration?.domains?.pipeline?.questions?.find(
    q => q.question_id === 'stage_history_tracked'
  );
  const stageHistoryOk = stageHistoryQ?.status === 'CONFIRMED' || stageHistoryQ?.status === 'INFERRED';

  const discoveries = [
    { ok: !!wi?.identity?.crm_type, label: `CRM Connected — ${crmType}`, questionId: null },
    { ok: activeStages.length > 0, label: `${activeStages.length} active pipeline stages detected`, questionId: 'pipeline_active_stages' },
    { ok: stageHistoryOk, label: 'Stage history available', questionId: 'stage_history_tracked' },
    { ok: false, label: 'No segment field confirmed', questionId: 'primary_segment_field' },
    { ok: false, label: 'No deal type taxonomy confirmed', questionId: 'deal_type_field' },
    { ok: false, label: 'No revenue model configured', questionId: 'revenue_model' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
      {/* Left: Auto-discovered */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
          Auto-Discovered
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {discoveries.map((d, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8,
            }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>
                {d.ok ? '✅' : i < 3 ? '⚠️' : '❌'}
              </span>
              <span style={{ flex: 1, fontSize: 13, color: colors.text }}>{d.label}</span>
              {d.questionId && (
                <button onClick={() => onJumpToQuestion(d.questionId!)} style={{
                  fontSize: 11, color: colors.accent, background: 'none', border: 'none',
                  cursor: 'pointer', fontFamily: fonts.sans, whiteSpace: 'nowrap',
                }}>
                  Configure →
                </button>
              )}
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 16, fontStyle: 'italic' }}>
          You can always come back and add more context.
        </p>
      </div>

      {/* Right: Upload + Notes */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
          Add Context
        </h3>
        <div style={{
          border: `2px dashed ${colors.border}`, borderRadius: 10, padding: '32px 24px',
          textAlign: 'center', marginBottom: 16, color: colors.textMuted,
          cursor: 'pointer', transition: 'border-color 0.15s',
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📎</div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Drop files here or click to browse</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>Accepts: PDF, DOCX, TXT, MD · Max 10MB</div>
          <div style={{ fontSize: 11, marginTop: 8, color: colors.accent }}>Saved locally — will be processed in a future update</div>
        </div>

        <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 500, color: colors.textSecondary }}>
          Or paste notes from the sales call:
        </div>
        <textarea
          value={notes}
          onChange={e => { setNotes(e.target.value); setSaved(false); }}
          placeholder="Key observations, context from the discovery call, anything Pandora should know..."
          style={{
            width: '100%', minHeight: 140, padding: 12,
            background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8,
            color: colors.text, fontSize: 13, fontFamily: fonts.sans, resize: 'vertical',
            outline: 'none', boxSizing: 'border-box',
          }}
        />
        <button
          onClick={() => setSaved(true)}
          style={{
            marginTop: 10, padding: '8px 16px', fontSize: 13, fontWeight: 500,
            background: colors.accent, color: '#fff', border: 'none', borderRadius: 6,
            cursor: 'pointer', fontFamily: fonts.sans,
          }}
        >
          {saved ? '✓ Saved' : 'Save Notes'}
        </button>
      </div>
    </div>
  );
}

// ─── Question Card ────────────────────────────────────────────────────────────

function QuestionCard({
  q, stages, onSave, onConfirm, saving,
}: {
  q: CalibrationQuestion;
  stages: string[];
  onSave: (questionId: string, value: any) => Promise<void>;
  onConfirm: (questionId: string) => Promise<void>;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState<any>(() => {
    const v = q.answer?.value;
    if (q.answer_type === 'multiselect' || q.answer_type === 'stage_picker') {
      return Array.isArray(v) ? v : [];
    }
    return v ?? '';
  });

  const currentValue = q.answer?.value;

  const statusColor = q.status === 'CONFIRMED'
    ? colors.green
    : q.status === 'INFERRED'
    ? colors.yellow
    : colors.border;

  const handleSave = async () => {
    await onSave(q.question_id, inputVal);
    setEditing(false);
  };

  const optionsList = q.answer_type === 'stage_picker'
    ? stages
    : (q.options || []);

  const renderInput = () => {
    if (q.answer_type === 'boolean') {
      return (
        <div style={{ display: 'flex', gap: 8 }}>
          {['Yes', 'No'].map(opt => (
            <button key={opt} onClick={() => setInputVal(opt === 'Yes')} style={{
              padding: '6px 16px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
              fontFamily: fonts.sans, fontWeight: 500,
              background: inputVal === (opt === 'Yes') ? colors.accent : colors.surfaceRaised,
              color: inputVal === (opt === 'Yes') ? '#fff' : colors.textSecondary,
              border: `1px solid ${inputVal === (opt === 'Yes') ? colors.accent : colors.border}`,
            }}>{opt}</button>
          ))}
        </div>
      );
    }
    if (q.answer_type === 'select') {
      return (
        <select value={inputVal} onChange={e => setInputVal(e.target.value)} style={{
          padding: '7px 10px', fontSize: 13, borderRadius: 6, width: '100%',
          background: colors.surface, border: `1px solid ${colors.border}`,
          color: colors.text, fontFamily: fonts.sans,
        }}>
          <option value="">Select an option...</option>
          {optionsList.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    }
    if (q.answer_type === 'multiselect' || q.answer_type === 'stage_picker') {
      const selected: string[] = Array.isArray(inputVal) ? inputVal : [];
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {optionsList.map(opt => {
            const active = selected.includes(opt);
            return (
              <button key={opt} onClick={() => setInputVal(active ? selected.filter(s => s !== opt) : [...selected, opt])} style={{
                padding: '4px 10px', fontSize: 12, borderRadius: 20, cursor: 'pointer',
                fontFamily: fonts.sans,
                background: active ? colors.accentSoft : colors.surfaceRaised,
                color: active ? colors.accent : colors.textSecondary,
                border: `1px solid ${active ? colors.accent : colors.border}`,
              }}>{opt}</button>
            );
          })}
        </div>
      );
    }
    if (q.answer_type === 'number') {
      return (
        <input type="number" value={inputVal} onChange={e => setInputVal(Number(e.target.value))} style={{
          padding: '7px 10px', fontSize: 13, borderRadius: 6, width: '50%',
          background: colors.surface, border: `1px solid ${colors.border}`,
          color: colors.text, fontFamily: fonts.sans,
        }} />
      );
    }
    return (
      <textarea value={inputVal} onChange={e => setInputVal(e.target.value)} rows={2} style={{
        padding: '7px 10px', fontSize: 13, borderRadius: 6, width: '100%',
        background: colors.surface, border: `1px solid ${colors.border}`,
        color: colors.text, fontFamily: fonts.sans, resize: 'vertical', boxSizing: 'border-box',
      }} />
    );
  };

  const displayAnswer = () => {
    const v = currentValue;
    if (v === null || v === undefined) return null;
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
  };

  return (
    <div style={{
      border: `1px solid ${statusColor === colors.border ? colors.border : statusColor + '50'}`,
      borderLeft: `3px solid ${statusColor}`,
      borderRadius: 8, padding: 16, background: colors.surface,
      opacity: q.depends_on.length > 0 && q.status === 'UNKNOWN' ? 0.6 : 1,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, lineHeight: 1.4 }}>
            {q.question}
          </div>
          {q.description && (
            <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>{q.description}</div>
          )}
          {q.skill_dependencies.length > 0 && (
            <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 4 }}>
              Used by: {q.skill_dependencies.slice(0, 2).join(', ')}{q.skill_dependencies.length > 2 ? ` +${q.skill_dependencies.length - 2} more` : ''}
            </div>
          )}
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          padding: '3px 8px', borderRadius: 4,
          background: q.required_for_live ? colors.redSoft : colors.surfaceRaised,
          color: q.required_for_live ? colors.red : colors.textMuted,
        }}>
          {q.required_for_live ? 'Required' : 'Optional'}
        </span>
      </div>

      {/* Blocked */}
      {q.depends_on.length > 0 && q.status === 'UNKNOWN' && (
        <div style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic', marginBottom: 8 }}>
          Answer {q.depends_on.join(', ')} first
        </div>
      )}

      {/* INFERRED state */}
      {q.status === 'INFERRED' && !editing && (
        <div style={{ marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
              padding: '2px 8px', borderRadius: 4, background: colors.yellowSoft, color: colors.yellow,
            }}>
              INFERRED {q.answer_source ? `· ${q.answer_source.replace('_', ' ')}` : ''}
            </span>
          </div>
          <div style={{ fontSize: 13, color: colors.text, marginBottom: 10, fontFamily: fonts.mono }}>
            {displayAnswer() || '—'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onConfirm(q.question_id)} disabled={saving} style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
              background: colors.green, color: '#fff', border: 'none', cursor: 'pointer',
              fontFamily: fonts.sans, opacity: saving ? 0.6 : 1,
            }}>
              ✓ Confirm
            </button>
            <button onClick={() => setEditing(true)} style={{
              padding: '6px 12px', fontSize: 12, borderRadius: 6,
              background: 'none', color: colors.textSecondary,
              border: `1px solid ${colors.border}`, cursor: 'pointer', fontFamily: fonts.sans,
            }}>
              Edit
            </button>
          </div>
        </div>
      )}

      {/* CONFIRMED state */}
      {q.status === 'CONFIRMED' && !editing && (
        <div style={{ marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
              padding: '2px 8px', borderRadius: 4, background: colors.greenSoft, color: colors.green,
            }}>
              ✓ CONFIRMED
            </span>
            {q.confirmed_by && (
              <span style={{ fontSize: 11, color: colors.textMuted }}>by {q.confirmed_by}</span>
            )}
          </div>
          <div style={{ fontSize: 13, color: colors.text, marginBottom: 8, fontFamily: fonts.mono }}>
            {displayAnswer() || '—'}
          </div>
          <button onClick={() => setEditing(true)} style={{
            padding: '5px 12px', fontSize: 12, borderRadius: 6,
            background: 'none', color: colors.textSecondary,
            border: `1px solid ${colors.border}`, cursor: 'pointer', fontFamily: fonts.sans,
          }}>
            Edit
          </button>
        </div>
      )}

      {/* UNKNOWN or editing state */}
      {(q.status === 'UNKNOWN' || editing) && (
        <div style={{ marginTop: 8 }}>
          {renderInput()}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={handleSave} disabled={saving || inputVal === '' || inputVal === null} style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
              background: colors.accent, color: '#fff', border: 'none', cursor: 'pointer',
              fontFamily: fonts.sans, opacity: saving ? 0.6 : 1,
            }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {editing && (
              <button onClick={() => setEditing(false)} style={{
                padding: '6px 12px', fontSize: 12, borderRadius: 6,
                background: 'none', color: colors.textSecondary,
                border: `1px solid ${colors.border}`, cursor: 'pointer', fontFamily: fonts.sans,
              }}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Phase 2: Checklist ───────────────────────────────────────────────────────

function Phase2Checklist({
  calibration, wi, jumpToDomain, jumpToQuestion, onAnswerSaved,
}: {
  calibration: CalibrationData | null;
  wi: WI | null;
  jumpToDomain: string | null;
  jumpToQuestion: string | null;
  onAnswerSaved: () => void;
}) {
  const { currentWorkspace } = useWorkspace();
  const userEmail = (currentWorkspace as any)?.email ?? 'specialist@pandora.ai';
  const [activeDomain, setActiveDomain] = useState('pipeline');
  const [saving, setSaving] = useState<string | null>(null);
  const domainRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const stages = (wi?.pipeline?.active_stages ?? []).map((s: any) => s.name ?? String(s));

  useEffect(() => {
    if (jumpToDomain) {
      setActiveDomain(jumpToDomain);
      setTimeout(() => {
        domainRefs.current[jumpToDomain]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [jumpToDomain]);

  useEffect(() => {
    if (jumpToQuestion && calibration) {
      for (const [domain, data] of Object.entries(calibration.domains)) {
        if (data.questions.some(q => q.question_id === jumpToQuestion)) {
          setActiveDomain(domain);
          setTimeout(() => {
            const el = document.getElementById(`q-${jumpToQuestion}`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 150);
          break;
        }
      }
    }
  }, [jumpToQuestion, calibration]);

  const handleSave = useCallback(async (questionId: string, value: any) => {
    setSaving(questionId);
    try {
      await api.patch(`/calibration/${questionId}`, {
        answer: { value },
        status: 'CONFIRMED',
        confirmed_by: userEmail,
      });
      onAnswerSaved();
    } finally {
      setSaving(null);
    }
  }, [userEmail, onAnswerSaved]);

  const handleConfirm = useCallback(async (questionId: string) => {
    setSaving(questionId);
    const q = Object.values(calibration?.domains ?? {})
      .flatMap(d => d.questions)
      .find(q => q.question_id === questionId);
    if (!q) { setSaving(null); return; }
    try {
      await api.patch(`/calibration/${questionId}`, {
        answer: q.answer || { value: q.answer?.value },
        status: 'CONFIRMED',
        confirmed_by: userEmail,
      });
      onAnswerSaved();
    } finally {
      setSaving(null);
    }
  }, [calibration, userEmail, onAnswerSaved]);

  if (!calibration) {
    return <div style={{ color: colors.textMuted, fontSize: 14, padding: 32, textAlign: 'center' }}>Loading checklist…</div>;
  }

  const totalConfirmed = DOMAIN_ORDER.reduce((s, d) => s + (calibration.domains[d]?.confirmed ?? 0), 0);
  const totalInferred  = DOMAIN_ORDER.reduce((s, d) => s + (calibration.domains[d]?.inferred ?? 0), 0);
  const totalQuestions = DOMAIN_ORDER.reduce((s, d) => s + (calibration.domains[d]?.total ?? 0), 0);
  const answeredCount  = totalConfirmed + totalInferred;

  // Check priority skills configured
  const priorityDomains = ['pipeline', 'metrics'];
  const allPriorityAnswered = priorityDomains.every(d => {
    const dom = calibration.domains[d];
    if (!dom) return false;
    const requiredQs = dom.questions.filter(q => q.required_for_live);
    return requiredQs.every(q => q.status === 'CONFIRMED' || q.status === 'INFERRED');
  });

  return (
    <div style={{ display: 'flex', gap: 0, height: '100%' }}>
      {/* Sidebar */}
      <div style={{
        width: 220, flexShrink: 0, borderRight: `1px solid ${colors.border}`,
        paddingRight: 20, marginRight: 28,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
          Domains
        </div>
        {DOMAIN_ORDER.map(domain => {
          const d = calibration.domains[domain];
          if (!d) return null;
          const filled = d.confirmed + d.inferred;
          const isActive = activeDomain === domain;
          return (
            <button key={domain} onClick={() => {
              setActiveDomain(domain);
              domainRefs.current[domain]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }} style={{
              width: '100%', textAlign: 'left', padding: '9px 12px',
              background: isActive ? colors.accentSoft : 'none',
              border: `1px solid ${isActive ? colors.accent : 'transparent'}`,
              borderRadius: 7, cursor: 'pointer', marginBottom: 4,
              fontFamily: fonts.sans,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: isActive ? colors.accent : colors.text }}>
                  {DOMAIN_LABELS[domain]}
                </span>
                <span style={{ fontSize: 11, color: colors.textMuted }}>
                  {filled}/{d.total}
                </span>
              </div>
              <ProgressBar value={(filled / d.total) * 100} color={isActive ? colors.accent : colors.green} />
            </button>
          );
        })}
        <div style={{ borderTop: `1px solid ${colors.border}`, marginTop: 12, paddingTop: 12, fontSize: 12, color: colors.textMuted }}>
          Total: {answeredCount} / {totalQuestions}
        </div>
      </div>

      {/* Question list */}
      <div style={{ flex: 1, overflowY: 'auto', maxHeight: '65vh' }}>
        {allPriorityAnswered && (
          <div style={{
            background: colors.greenSoft, border: `1px solid ${colors.green}`,
            borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: colors.green,
          }}>
            ✅ Priority skills configured. Continue to confirmation, or keep filling in optional questions.
          </div>
        )}

        {DOMAIN_ORDER.map(domain => {
          const d = calibration.domains[domain];
          if (!d) return null;
          return (
            <div key={domain} ref={el => { domainRefs.current[domain] = el; }} style={{ marginBottom: 40 }}>
              <div style={{
                position: 'sticky', top: 0, zIndex: 2,
                background: colors.bg, borderBottom: `1px solid ${colors.border}`,
                padding: '10px 0 10px', marginBottom: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: colors.text }}>{DOMAIN_LABELS[domain]}</span>
                  <span style={{ fontSize: 12, color: colors.textMuted }}>
                    {d.confirmed + d.inferred} / {d.total} answered
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: colors.accent }}>{d.score}%</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {d.questions.map(q => (
                  <div id={`q-${q.question_id}`} key={q.question_id}>
                    <QuestionCard
                      q={q}
                      stages={stages}
                      onSave={handleSave}
                      onConfirm={handleConfirm}
                      saving={saving === q.question_id}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Phase 3: Confirm Metrics ─────────────────────────────────────────────────

function Phase3Confirm({ metrics, onAnswerSaved }: { metrics: MetricItem[] | null; onAnswerSaved: () => void }) {
  const { currentWorkspace } = useWorkspace();
  const userEmail = (currentWorkspace as any)?.email ?? 'specialist@pandora.ai';
  const [confirmState, setConfirmState] = useState<Record<string, 'confirmed' | 'rejected' | null>>({});
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [correctionReasons, setCorrectionReasons] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  if (!metrics) {
    return <div style={{ color: colors.textMuted, fontSize: 14, padding: 32, textAlign: 'center' }}>Loading metrics…</div>;
  }

  const metricsWithValues = metrics.filter(m => m.last_computed_value !== null);
  const confirmedCount = Object.values(confirmState).filter(s => s !== null).length;

  const handleConfirm = async (metricKey: string, isConfirmed: boolean) => {
    setSaving(metricKey);
    const m = metrics.find(m => m.metric_key === metricKey);
    if (!m) { setSaving(null); return; }
    try {
      const confirmedValue = isConfirmed
        ? m.last_computed_value
        : parseFloat(corrections[metricKey]) || m.last_computed_value;
      await api.post(`/metrics/${metricKey}/confirm`, {
        confirmed_value: confirmedValue,
        confirmed: isConfirmed,
        confirmed_by: userEmail,
      });
      setConfirmState(s => ({ ...s, [metricKey]: isConfirmed ? 'confirmed' : 'rejected' }));
      onAnswerSaved();
    } finally {
      setSaving(null);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 4 }}>
          {confirmedCount} of {metricsWithValues.length} metrics confirmed
        </div>
        <ProgressBar value={metricsWithValues.length > 0 ? (confirmedCount / metricsWithValues.length) * 100 : 0} />
        <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 8 }}>
          Pandora computed baseline numbers from your CRM. Confirm whether they match your records.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {metricsWithValues.map(m => {
          const state = confirmState[m.metric_key];
          const isConfirmed = state === 'confirmed';
          const isRejected = state === 'rejected';
          const cardBg = isConfirmed ? colors.greenSoft : isRejected ? colors.yellowSoft : colors.surface;
          const cardBorder = isConfirmed ? colors.green : isRejected ? colors.yellow : colors.border;

          return (
            <div key={m.metric_key} style={{
              background: cardBg, border: `1px solid ${cardBorder}`,
              borderRadius: 10, padding: 18, transition: 'background 0.2s, border-color 0.2s',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>{m.label}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                  padding: '2px 8px', borderRadius: 4,
                  background: m.confidence === 'CONFIRMED' ? colors.greenSoft : colors.yellowSoft,
                  color: m.confidence === 'CONFIRMED' ? colors.green : colors.yellow,
                }}>
                  {m.confidence}
                </span>
              </div>

              <div style={{ fontSize: 24, fontWeight: 700, color: colors.text, marginBottom: 4, fontFamily: fonts.mono }}>
                {formatValue(m.last_computed_value, m.unit)}
              </div>
              <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 14 }}>
                Pandora calculated · {m.unit}
              </div>

              {!state && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleConfirm(m.metric_key, true)} disabled={saving === m.metric_key} style={{
                    flex: 1, padding: '8px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                    background: colors.green, color: '#fff', border: 'none', cursor: 'pointer',
                    fontFamily: fonts.sans, opacity: saving === m.metric_key ? 0.6 : 1,
                  }}>
                    ✓ Yes, that's right
                  </button>
                  <button onClick={() => setConfirmState(s => ({ ...s, [m.metric_key]: 'rejected' }))} style={{
                    flex: 1, padding: '8px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                    background: colors.redSoft, color: colors.red, border: `1px solid ${colors.red}`,
                    cursor: 'pointer', fontFamily: fonts.sans,
                  }}>
                    ✗ No, fix it
                  </button>
                </div>
              )}

              {isRejected && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 6 }}>
                    What should {m.label} be?
                  </div>
                  <input
                    type="number"
                    placeholder="e.g. 0.28"
                    value={corrections[m.metric_key] ?? ''}
                    onChange={e => setCorrections(c => ({ ...c, [m.metric_key]: e.target.value }))}
                    style={{
                      width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 6,
                      background: colors.surface, border: `1px solid ${colors.border}`,
                      color: colors.text, fontFamily: fonts.sans, boxSizing: 'border-box', marginBottom: 8,
                    }}
                  />
                  <button onClick={() => handleConfirm(m.metric_key, false)} disabled={saving === m.metric_key} style={{
                    width: '100%', padding: '7px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                    background: colors.yellow, color: '#000', border: 'none', cursor: 'pointer',
                    fontFamily: fonts.sans, opacity: saving === m.metric_key ? 0.6 : 1,
                  }}>
                    Submit Correction
                  </button>
                  <p style={{ fontSize: 11, color: colors.textMuted, marginTop: 6, fontStyle: 'italic' }}>
                    Pandora's calculation will be reviewed.
                  </p>
                </div>
              )}

              {isConfirmed && (
                <div style={{ fontSize: 12, color: colors.green, fontWeight: 500 }}>✓ Confirmed</div>
              )}
            </div>
          );
        })}

        {metrics.filter(m => m.last_computed_value === null).map(m => (
          <div key={m.metric_key} style={{
            background: colors.surface, border: `1px solid ${colors.border}`,
            borderRadius: 10, padding: 18, opacity: 0.6,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 8 }}>{m.label}</div>
            <div style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic' }}>Not yet computed</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Phase 4: Lock ────────────────────────────────────────────────────────────

function Phase4Lock({ wi, calibration, onJumpToQuestion }: {
  wi: WI | null;
  calibration: CalibrationData | null;
  onJumpToQuestion: (questionId: string) => void;
}) {
  if (!wi || !calibration) {
    return <div style={{ color: colors.textMuted, fontSize: 14, padding: 32, textAlign: 'center' }}>Loading…</div>;
  }

  const readiness = wi.readiness;
  const skillGates = readiness.skill_gates ?? [];
  const liveCount    = skillGates.filter(g => g.status === 'LIVE').length;
  const draftCount   = skillGates.filter(g => g.status === 'DRAFT').length;
  const blockedCount = skillGates.filter(g => g.status === 'BLOCKED').length;
  const gapCount     = readiness.blocking_gaps?.length ?? 0;

  return (
    <div>
      {/* Readiness summary */}
      <div style={{
        background: colors.surface, border: `1px solid ${colors.border}`,
        borderRadius: 10, padding: 24, marginBottom: 24,
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: colors.text, marginBottom: 16 }}>
          Configuration Readiness
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: colors.textSecondary }}>Overall</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: colors.accent }}>{readiness.overall_score}%</span>
          </div>
          <ProgressBar value={readiness.overall_score} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {DOMAIN_ORDER.map(domain => {
            const d = readiness.by_domain?.[domain];
            if (!d) return null;
            return (
              <div key={domain}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: colors.textSecondary }}>{DOMAIN_LABELS[domain]}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>{d.score ?? 0}%</span>
                </div>
                <ProgressBar value={d.score ?? 0} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Skill gates table */}
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, marginBottom: 24, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${colors.border}`, fontSize: 14, fontWeight: 600, color: colors.text }}>
          Skill Gates
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {['Skill', 'Gate', 'Missing'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 20px', fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skillGates.map(gate => (
              <tr key={gate.skill_id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={{ padding: '11px 20px', fontSize: 13, color: colors.text, fontWeight: 500 }}>
                  {gate.skill_name}
                </td>
                <td style={{ padding: '11px 20px' }}>
                  <StatusDot status={gate.status} />
                </td>
                <td style={{ padding: '11px 20px' }}>
                  {gate.missing_items.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {gate.missing_items.map(item => (
                        <button key={item} onClick={() => onJumpToQuestion(item)} style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 4,
                          background: colors.redSoft, color: colors.red,
                          border: 'none', cursor: 'pointer', fontFamily: fonts.mono,
                        }}>
                          {item}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: colors.textMuted }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Gaps summary */}
      {gapCount > 0 && (
        <div style={{
          background: colors.yellowSoft, border: `1px solid ${colors.yellow}`,
          borderRadius: 8, padding: 16, marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: colors.yellow, marginBottom: 8 }}>
            ⚠️ {gapCount} required question{gapCount !== 1 ? 's' : ''} unanswered
          </div>
          {draftCount > 0 && (
            <div style={{ fontSize: 12, color: colors.text }}>
              These skills will run in DRAFT mode until configured:&nbsp;
              <span style={{ fontWeight: 500 }}>
                {skillGates.filter(g => g.status === 'DRAFT').map(g => g.skill_name).slice(0, 4).join(', ')}
                {draftCount > 4 ? ` +${draftCount - 4} more` : ''}
              </span>
            </div>
          )}
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 8 }}>
            Skills in DRAFT mode include a warning in their output. Results are directionally correct.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 20, fontSize: 13, color: colors.textSecondary, alignItems: 'center' }}>
          <span>● LIVE: <strong style={{ color: colors.green }}>{liveCount}</strong></span>
          <span>● DRAFT: <strong style={{ color: colors.yellow }}>{draftCount}</strong></span>
          {blockedCount > 0 && <span>● BLOCKED: <strong style={{ color: colors.red }}>{blockedCount}</strong></span>}
        </div>
      </div>
    </div>
  );
}

// ─── Phase 5: Infuse ──────────────────────────────────────────────────────────

function Phase5Infuse({ wi, calibration, metrics }: {
  wi: WI | null;
  calibration: CalibrationData | null;
  metrics: MetricItem[] | null;
}) {
  if (!wi || !calibration) {
    return <div style={{ color: colors.textMuted, fontSize: 14, padding: 32, textAlign: 'center' }}>Loading…</div>;
  }

  const gates  = wi.readiness.skill_gates ?? [];
  const liveSkills  = gates.filter(g => g.status === 'LIVE').length;
  const draftSkills = gates.filter(g => g.status === 'DRAFT').length;
  const totalSkills = gates.length;

  const totalAnswered = DOMAIN_ORDER.reduce((s, d) => s + (calibration.domains[d]?.confirmed ?? 0) + (calibration.domains[d]?.inferred ?? 0), 0);
  const totalQuestions = DOMAIN_ORDER.reduce((s, d) => s + (calibration.domains[d]?.total ?? 0), 0);
  const confirmedMetrics = (metrics ?? []).filter(m => m.confidence === 'CONFIRMED').length;
  const totalMetrics     = (metrics ?? []).length;

  const nextSteps = (wi.readiness.blocking_gaps ?? []).slice(0, 5).map(g => ({
    id: g.question_id,
    label: g.label,
  }));

  const handleDownload = () => {
    const lines: string[] = [`# Pandora Configuration Summary\n`];
    lines.push(`Generated: ${new Date().toLocaleString()}\n`);
    lines.push(`Workspace: ${wi.identity?.workspace_name ?? 'Unknown'}\n\n`);
    for (const domain of DOMAIN_ORDER) {
      const d = calibration.domains[domain];
      if (!d) continue;
      lines.push(`## ${DOMAIN_LABELS[domain]} (${d.confirmed + d.inferred}/${d.total})\n`);
      for (const q of d.questions.filter(q => q.status === 'CONFIRMED' || q.status === 'INFERRED')) {
        const val = Array.isArray(q.answer?.value) ? q.answer?.value.join(', ') : q.answer?.value;
        lines.push(`- **${q.question}**: ${val ?? '—'} [${q.status}]\n`);
      }
      lines.push('\n');
    }
    const blob = new Blob([lines.join('')], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pandora-configuration-summary.md';
    a.click();
  };

  const prioritySkills = ['Pipeline Waterfall', 'Pipeline Coverage', 'Rep Scorecard', 'Forecast Rollup'];

  return (
    <div>
      {/* Activation summary */}
      <div style={{
        background: colors.greenSoft, border: `1px solid ${colors.green}`,
        borderRadius: 10, padding: 24, marginBottom: 28,
      }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: colors.green, marginBottom: 4 }}>
          ✅ WorkspaceIntelligence Active
        </div>
        <div style={{ fontSize: 14, color: colors.text, marginBottom: 20 }}>
          Pandora now knows your business.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            { label: 'Configured', value: `${totalAnswered} / ${totalQuestions} answers` },
            { label: 'Skills going LIVE', value: `${liveSkills} / ${totalSkills}` },
            { label: 'Skills in DRAFT', value: `${draftSkills} / ${totalSkills}` },
            { label: 'Metrics confirmed', value: `${confirmedMetrics} / ${totalMetrics}` },
          ].map(item => (
            <div key={item.label} style={{ background: colors.surface, borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{item.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: colors.text, marginTop: 4, fontFamily: fonts.mono }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* What's different */}
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 20, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 14 }}>
          What's Different Now
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {prioritySkills.map(skillName => {
            const gate = (wi.readiness.skill_gates ?? []).find(g => g.skill_name.toLowerCase().includes(skillName.toLowerCase().split(' ')[1]));
            const isLive = gate?.status === 'LIVE';
            const missing = gate?.missing_items ?? [];
            return (
              <div key={skillName} style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{skillName}</span>
                  {gate && <StatusDot status={gate.status} />}
                </div>
                <div style={{ fontSize: 12, color: colors.textMuted }}>
                  {isLive
                    ? `Before: Generic output without stage config.  After: Uses your confirmed configuration and WI context.`
                    : missing.length > 0
                    ? `Still in DRAFT — confirm ${missing.slice(0, 2).join(', ')} to go LIVE`
                    : `Running with current configuration`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Next steps */}
      {nextSteps.length > 0 && (
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
            To Complete Configuration
          </div>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {nextSteps.map((step, i) => (
              <li key={step.id} style={{ fontSize: 13, color: colors.textSecondary }}>
                Confirm <code style={{ background: colors.surfaceRaised, padding: '1px 6px', borderRadius: 4, fontFamily: fonts.mono, fontSize: 12 }}>{step.id}</code>
                {step.label ? ` → enables ${step.label}` : ''}
              </li>
            ))}
          </ol>
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 12, fontStyle: 'italic' }}>
            Schedule a 30-min follow-up to confirm remaining metrics.
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={handleDownload} style={{
          padding: '10px 20px', fontSize: 13, fontWeight: 600, borderRadius: 7,
          background: colors.surfaceRaised, color: colors.text,
          border: `1px solid ${colors.border}`, cursor: 'pointer', fontFamily: fonts.sans,
        }}>
          ↓ Download Configuration Summary
        </button>
        <button onClick={() => window.location.href = '/gtm'} style={{
          padding: '10px 20px', fontSize: 13, fontWeight: 600, borderRadius: 7,
          background: colors.accent, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: fonts.sans,
        }}>
          Run Skills Now →
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ForwardDeployTab() {
  const [phase, setPhase] = useState<Phase>(1);
  const [wi, setWI] = useState<WI | null>(null);
  const [calibration, setCalibration] = useState<CalibrationData | null>(null);
  const [metrics, setMetrics] = useState<MetricItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: 'error' | 'success' } | null>(null);
  const [jumpToDomain, setJumpToDomain] = useState<string | null>(null);
  const [jumpToQuestion, setJumpToQuestion] = useState<string | null>(null);

  const showToast = (msg: string, type: 'error' | 'success' = 'error') =>
    setToast({ msg, type });

  const loadData = useCallback(async () => {
    try {
      const [wiRes, calRes, metRes] = await Promise.all([
        api.get('/intelligence'),
        api.get('/calibration'),
        api.get('/metrics'),
      ]);
      if (wiRes.success)  setWI(wiRes.data);
      if (calRes.success) setCalibration(calRes.data);
      if (metRes.success) setMetrics(metRes.data);
    } catch (err: any) {
      showToast('Failed to load workspace data. ' + (err.message ?? ''));
    } finally {
      setLoading(false);
    }
  }, []);

  // Lightweight readiness refresh after each answer
  const refreshReadiness = useCallback(async () => {
    try {
      const [calRes, wiRes] = await Promise.all([
        api.get('/calibration'),
        api.get('/intelligence/readiness'),
      ]);
      if (calRes.success) setCalibration(calRes.data);
      if (wiRes.success)  setWI(prev => prev ? { ...prev, readiness: wiRes.data } : prev);
    } catch {
      /* silent — data already shown */
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleJumpToQuestion = (questionId: string) => {
    setPhase(2);
    setJumpToQuestion(questionId);
    setTimeout(() => setJumpToQuestion(null), 500);
  };

  const handleJumpToDomain = (domain: string) => {
    setPhase(2);
    setJumpToDomain(domain);
    setTimeout(() => setJumpToDomain(null), 500);
  };

  const readiness = wi?.readiness;
  const overallScore = readiness?.overall_score ?? 0;
  const skillGates   = readiness?.skill_gates ?? [];
  const liveCount    = skillGates.filter(g => g.status === 'LIVE').length;
  const draftCount   = skillGates.filter(g => g.status === 'DRAFT').length;
  const blockedCount = skillGates.filter(g => g.status === 'BLOCKED').length;

  const workspaceName = wi?.identity?.workspace_name ?? 'Workspace';

  const PHASE_COMPLETE: Record<Phase, boolean> = {
    1: true,
    2: overallScore > 0,
    3: (metrics ?? []).filter(m => m.last_computed_value !== null).length > 0,
    4: true,
    5: true,
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '40px 0' }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{
            height: 60, background: colors.surface, border: `1px solid ${colors.border}`,
            borderRadius: 8, animation: 'pulse 1.5s ease-in-out infinite', opacity: 0.6,
          }} />
        ))}
        <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.7} }`}</style>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, fontFamily: fonts.sans }}>
      {/* Persistent header */}
      <div style={{
        background: colors.surface, border: `1px solid ${colors.border}`,
        borderRadius: 10, padding: '18px 24px', marginBottom: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: colors.text, margin: 0 }}>
              Forward Deployment — {workspaceName}
            </h2>
            <p style={{ fontSize: 13, color: colors.textMuted, margin: '4px 0 0' }}>
              Configure Pandora's understanding of your business
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: colors.accent, fontFamily: fonts.mono }}>
              {overallScore}%
            </div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>Readiness</div>
          </div>
        </div>
        <ProgressBar value={overallScore} />
        <div style={{ display: 'flex', gap: 20, marginTop: 12, fontSize: 13 }}>
          <span style={{ color: colors.green }}>● LIVE: <strong>{liveCount}</strong></span>
          <span style={{ color: colors.yellow }}>● DRAFT: <strong>{draftCount}</strong></span>
          {blockedCount > 0 && <span style={{ color: colors.red }}>● BLOCKED: <strong>{blockedCount}</strong></span>}
        </div>
      </div>

      {/* Phase stepper */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28 }}>
        {PHASE_LABELS.map((label, i) => {
          const p = (i + 1) as Phase;
          const isActive   = phase === p;
          const isComplete = PHASE_COMPLETE[p] && p < phase;
          return (
            <React.Fragment key={p}>
              <button
                onClick={() => setPhase(p)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
                  background: isActive ? colors.accentSoft : 'none',
                  border: `1px solid ${isActive ? colors.accent : 'transparent'}`,
                  borderRadius: 20, cursor: 'pointer', fontFamily: fonts.sans,
                  color: isActive ? colors.accent : isComplete ? colors.green : colors.textMuted,
                  fontSize: 13, fontWeight: isActive ? 600 : 400,
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
                  background: isActive ? colors.accent : isComplete ? colors.green : colors.border,
                  color: isActive || isComplete ? '#fff' : colors.textMuted,
                }}>
                  {isComplete ? '✓' : p}
                </span>
                {label}
              </button>
              {i < 4 && (
                <div style={{ width: 24, height: 1, background: colors.border, flexShrink: 0 }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Phase content */}
      <div style={{ marginBottom: 32 }}>
        {phase === 1 && (
          <Phase1Ingest wi={wi} calibration={calibration} onJumpToQuestion={handleJumpToQuestion} />
        )}
        {phase === 2 && (
          <Phase2Checklist
            calibration={calibration}
            wi={wi}
            jumpToDomain={jumpToDomain}
            jumpToQuestion={jumpToQuestion}
            onAnswerSaved={refreshReadiness}
          />
        )}
        {phase === 3 && (
          <Phase3Confirm metrics={metrics} onAnswerSaved={refreshReadiness} />
        )}
        {phase === 4 && (
          <Phase4Lock wi={wi} calibration={calibration} onJumpToQuestion={handleJumpToQuestion} />
        )}
        {phase === 5 && (
          <Phase5Infuse wi={wi} calibration={calibration} metrics={metrics} />
        )}
      </div>

      {/* Navigation */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', gap: 12,
        borderTop: `1px solid ${colors.border}`, paddingTop: 20,
      }}>
        {phase > 1 && (
          <button onClick={() => setPhase(p => (p - 1) as Phase)} style={{
            padding: '9px 20px', fontSize: 13, fontWeight: 500, borderRadius: 7,
            background: 'none', color: colors.textSecondary,
            border: `1px solid ${colors.border}`, cursor: 'pointer', fontFamily: fonts.sans,
          }}>
            ← Back
          </button>
        )}
        {phase < 5 && (
          <button onClick={() => setPhase(p => (p + 1) as Phase)} style={{
            padding: '9px 20px', fontSize: 13, fontWeight: 600, borderRadius: 7,
            background: colors.accent, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: fonts.sans,
          }}>
            {phase === 4 ? 'Lock and Continue →' : 'Continue →'}
          </button>
        )}
        {phase === 5 && (
          <button onClick={() => setPhase(1)} style={{
            padding: '9px 20px', fontSize: 13, fontWeight: 500, borderRadius: 7,
            background: 'none', color: colors.textSecondary,
            border: `1px solid ${colors.border}`, cursor: 'pointer', fontFamily: fonts.sans,
          }}>
            ↺ Start Over
          </button>
        )}
      </div>

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
