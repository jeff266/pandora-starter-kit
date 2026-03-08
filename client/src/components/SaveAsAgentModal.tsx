import React, { useState } from 'react';
import { api } from '../lib/api';

interface ExtractionResult {
  suggested_name: string;
  goal: string;
  standing_questions: string[];
  detected_skills: string[];
  suggested_schedule: { cron: string; label: string };
  suggested_delivery: { format: string; channel?: string };
  confidence: string;
}

interface SaveAsAgentModalProps {
  extraction: ExtractionResult;
  threadId: string;
  onSave: (agentId: string, agentName: string) => void;
  onClose: () => void;
}

const SCHEDULE_OPTIONS = [
  { label: 'Every Monday at 7 AM', cron: '0 7 * * 1' },
  { label: 'Every Monday at 8 AM', cron: '0 8 * * 1' },
  { label: 'Every weekday at 7 AM', cron: '0 7 * * 1-5' },
  { label: '1st of every month at 8 AM', cron: '0 8 1 * *' },
  { label: 'On demand', cron: '' },
];

const SKILL_LABELS: Record<string, string> = {
  'pipeline-hygiene': 'Pipeline Hygiene',
  'rep-scorecard': 'Rep Scorecard',
  'forecast-rollup': 'Forecast Roll-up',
  'single-thread-alert': 'Single-Thread Alert',
  'data-quality': 'Data Quality Audit',
  'pipeline-coverage': 'Pipeline Coverage',
  'call-prep': 'Call Prep',
};

const colors = {
  bg: '#161926',
  surface: '#1e2230',
  surfaceRaised: '#252b3b',
  border: '#2a3147',
  accent: '#6488ea',
  text: '#e2e8f0',
  muted: '#64748b',
  coral: '#f87171',
  green: '#4ade80',
};

export default function SaveAsAgentModal({ extraction, threadId, onSave, onClose }: SaveAsAgentModalProps) {
  const [name, setName] = useState(extraction.suggested_name);
  const [goal, setGoal] = useState(extraction.goal);
  const [editingGoal, setEditingGoal] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState(
    SCHEDULE_OPTIONS.find(o => o.cron === extraction.suggested_schedule.cron) || SCHEDULE_OPTIONS[1]
  );
  const [deliveryFormat, setDeliveryFormat] = useState<'slack' | 'email' | 'command_center'>(
    (extraction.suggested_delivery.format as any) || 'slack'
  );
  const [deliveryChannel, setDeliveryChannel] = useState(extraction.suggested_delivery.channel || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const triggerConfig = selectedSchedule.cron
        ? { type: 'cron', cron: selectedSchedule.cron }
        : { type: 'manual' };

      const res = await api.post('/agents-v2', {
        name: name.trim(),
        description: goal,
        icon: '🤖',
        skill_ids: extraction.detected_skills.length > 0 ? extraction.detected_skills : [],
        trigger_config: triggerConfig,
        filter_config: {},
        is_active: !!selectedSchedule.cron,
        goal: goal.trim(),
        standing_questions: extraction.standing_questions,
        created_from: 'conversation',
        seed_conversation_id: threadId,
        output_formats: [deliveryFormat],
        audience: { role: 'VP Sales', detail_preference: 'manager' },
        data_window: { primary: 'current_week', comparison: 'previous_period' },
      });

      onSave(res.id || res.agent?.id || '', name.trim());
    } catch (e: any) {
      setError(e?.message || 'Failed to save agent');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        padding: '28px',
        width: '100%',
        maxWidth: 520,
        maxHeight: '90vh',
        overflowY: 'auto',
        color: colors.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: extraction.confidence === 'high' ? 8 : 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Save as Agent</h2>
            {extraction.confidence === 'high' && (
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '2px 8px',
                background: 'rgba(74, 222, 128, 0.12)', border: '1px solid rgba(74, 222, 128, 0.25)',
                borderRadius: 20, color: colors.green,
              }}>
                ✓ Auto-detected
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: colors.muted, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        {extraction.confidence === 'low' && (
          <div style={{
            marginBottom: 20,
            padding: '8px 12px',
            background: 'rgba(234, 179, 8, 0.08)',
            border: '1px solid rgba(234, 179, 8, 0.2)',
            borderRadius: 6,
            fontSize: 12,
            color: '#ca8a04',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            ⚠ Low confidence extraction — review fields before saving.
          </div>
        )}

        {/* Name */}
        <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box', background: colors.bg,
            border: `1px solid ${colors.border}`, borderRadius: 6,
            color: colors.text, padding: '8px 12px', fontSize: 14, marginBottom: 20,
          }}
        />

        {/* Goal */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ fontSize: 12, color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Goal</label>
            <button
              onClick={() => setEditingGoal(v => !v)}
              style={{ background: 'none', border: 'none', color: colors.accent, cursor: 'pointer', fontSize: 12 }}
            >
              {editingGoal ? 'Done' : 'Edit'}
            </button>
          </div>
          {editingGoal ? (
            <textarea
              value={goal}
              onChange={e => setGoal(e.target.value)}
              maxLength={200}
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', background: colors.bg,
                border: `1px solid ${colors.border}`, borderRadius: 6,
                color: colors.text, padding: '8px 12px', fontSize: 13,
                resize: 'vertical',
              }}
            />
          ) : (
            <div style={{
              background: colors.bg, border: `1px solid ${colors.border}`,
              borderRadius: 6, padding: '10px 12px', fontSize: 13,
              color: colors.text, lineHeight: 1.5, fontStyle: 'italic',
            }}>
              "{goal}"
            </div>
          )}
        </div>

        {/* Skills detected */}
        {extraction.detected_skills.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Skills Detected</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {extraction.detected_skills.map(s => (
                <div key={s} style={{
                  background: colors.bg, border: `1px solid ${colors.accent}`,
                  borderRadius: 20, padding: '4px 10px', fontSize: 12,
                  color: colors.accent, display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  ✓ {SKILL_LABELS[s] || s}
                </div>
              ))}
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 11, color: colors.muted }}>
              Skills cannot be changed here. To change skills, edit the Agent after saving.
            </p>
          </div>
        )}

        {/* Standing questions */}
        {extraction.standing_questions.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Standing Questions <span style={{ color: colors.muted, fontWeight: 400 }}>(answered each run)</span>
            </label>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: colors.text, lineHeight: 1.6 }}>
              {extraction.standing_questions.map((q, i) => (
                <li key={i} style={{ marginBottom: 4 }}>{q}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Schedule */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Schedule</label>
          <select
            value={selectedSchedule.cron}
            onChange={e => {
              const opt = SCHEDULE_OPTIONS.find(o => o.cron === e.target.value);
              if (opt) setSelectedSchedule(opt);
            }}
            style={{
              width: '100%', background: colors.bg, border: `1px solid ${colors.border}`,
              borderRadius: 6, color: colors.text, padding: '8px 12px', fontSize: 13,
            }}
          >
            {SCHEDULE_OPTIONS.map(o => (
              <option key={o.cron} value={o.cron}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Delivery */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Delivery</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={deliveryFormat}
              onChange={e => setDeliveryFormat(e.target.value as any)}
              style={{
                flex: '0 0 120px', background: colors.bg, border: `1px solid ${colors.border}`,
                borderRadius: 6, color: colors.text, padding: '8px 12px', fontSize: 13,
              }}
            >
              <option value="slack">Slack</option>
              <option value="email">Email</option>
              <option value="command_center">Command Center</option>
            </select>
            {deliveryFormat === 'slack' && (
              <input
                placeholder="#channel"
                value={deliveryChannel}
                onChange={e => setDeliveryChannel(e.target.value)}
                style={{
                  flex: 1, background: colors.bg, border: `1px solid ${colors.border}`,
                  borderRadius: 6, color: colors.text, padding: '8px 12px', fontSize: 13,
                }}
              />
            )}
            {deliveryFormat === 'email' && (
              <input
                placeholder="email@company.com"
                value={deliveryChannel}
                onChange={e => setDeliveryChannel(e.target.value)}
                style={{
                  flex: 1, background: colors.bg, border: `1px solid ${colors.border}`,
                  borderRadius: 6, color: colors.text, padding: '8px 12px', fontSize: 13,
                }}
              />
            )}
          </div>
        </div>

        {error && (
          <div style={{ color: colors.coral, fontSize: 13, marginBottom: 16 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: `1px solid ${colors.border}`,
              borderRadius: 6, color: colors.muted, padding: '8px 18px',
              cursor: 'pointer', fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: saving ? colors.muted : colors.accent,
              border: 'none', borderRadius: 6, color: '#fff',
              padding: '8px 22px', cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 600,
            }}
          >
            {saving ? 'Saving…' : 'Save Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
