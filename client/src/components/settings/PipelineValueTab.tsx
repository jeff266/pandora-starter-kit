import React, { useState, useEffect, useCallback } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';

// ============================================================================
// Types
// ============================================================================

interface NumericField {
  key: string;
  label: string;
}

interface PipelineConfig {
  id: string;
  name: string;
  value_field: string;
  value_formula?: string | null;
}

interface WorkspaceConfig {
  pipelines: PipelineConfig[];
}

// ============================================================================
// Styles
// ============================================================================

const sectionStyle: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: 24,
  marginBottom: 20,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: colors.textMuted,
  fontFamily: fonts.sans,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  marginBottom: 6,
  display: 'block',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  fontSize: 13,
  color: colors.text,
  fontFamily: fonts.sans,
  cursor: 'pointer',
  outline: 'none',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  fontSize: 13,
  color: colors.text,
  fontFamily: fonts.mono,
  outline: 'none',
  boxSizing: 'border-box',
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: colors.textMuted,
  fontFamily: fonts.sans,
  marginTop: 5,
};

// ============================================================================
// Per-pipeline editor
// ============================================================================

interface PipelineValueEditorProps {
  pipeline: PipelineConfig;
  numericFields: NumericField[];
  onSave: (pipelineId: string, valueField: string, valueFormula: string | null) => Promise<void>;
  saving: boolean;
}

function PipelineValueEditor({ pipeline, numericFields, onSave, saving }: PipelineValueEditorProps) {
  const [valueField, setValueField] = useState(pipeline.value_field || 'amount');
  const [valueFormula, setValueFormula] = useState(pipeline.value_formula || '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setValueField(pipeline.value_field || 'amount');
    setValueFormula(pipeline.value_formula || '');
    setDirty(false);
  }, [pipeline.id]);

  const handleFieldChange = (v: string) => { setValueField(v); setDirty(true); };
  const handleFormulaChange = (v: string) => { setValueFormula(v); setDirty(true); };

  const handleSave = async () => {
    try {
      await onSave(pipeline.id, valueField, valueFormula.trim() || null);
      setDirty(false);
    } catch {
      // parent shows toast; leave dirty so user can retry
    }
  };

  const selectedFieldLabel = numericFields.find(f => f.key === valueField)?.label || valueField;

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>
            {pipeline.name}
          </div>
          <div style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans, marginTop: 2 }}>
            Currently: <span style={{ color: colors.accent, fontFamily: fonts.mono }}>{selectedFieldLabel}</span>
            {pipeline.value_formula && (
              <span style={{ marginLeft: 8, color: colors.textMuted }}>
                formula: <span style={{ fontFamily: fonts.mono }}>{pipeline.value_formula}</span>
              </span>
            )}
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          style={{
            padding: '6px 16px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: fonts.sans,
            background: dirty && !saving ? colors.accent : colors.surfaceRaised,
            color: dirty && !saving ? '#fff' : colors.textMuted,
            border: 'none',
            cursor: dirty && !saving ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s',
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label style={labelStyle}>Value Field</label>
          <select
            value={valueField}
            onChange={e => handleFieldChange(e.target.value)}
            style={selectStyle}
          >
            {numericFields.map(f => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          <span style={hintStyle}>Field used as deal value for this pipeline.</span>
        </div>

        <div>
          <label style={labelStyle}>Value Formula (optional)</label>
          <input
            type="text"
            value={valueFormula}
            onChange={e => handleFormulaChange(e.target.value)}
            placeholder="{arr_value} / 12"
            style={inputStyle}
          />
          <span style={hintStyle}>
            e.g. <code style={{ fontFamily: fonts.mono }}>{'{arr_value} / 12'}</code> or{' '}
            <code style={{ fontFamily: fonts.mono }}>{'{acv_amount} || {amount}'}</code>.
            Leave blank to use the field directly.
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Tab
// ============================================================================

export default function PipelineValueTab() {
  const [pipelines, setPipelines] = useState<PipelineConfig[]>([]);
  const [numericFields, setNumericFields] = useState<NumericField[]>([
    { key: 'amount', label: 'Amount (default)' },
  ]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, fieldsRes] = await Promise.all([
        api.get('/workspace-config') as Promise<{ config: WorkspaceConfig }>,
        api.get('/admin/numeric-fields') as Promise<{ fields: NumericField[] }>,
      ]);
      setPipelines(configRes.config?.pipelines || []);
      if (fieldsRes.fields?.length) {
        setNumericFields(fieldsRes.fields);
      }
    } catch (err: any) {
      showToast('error', err.message || 'Failed to load pipeline config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (pipelineId: string, valueField: string, valueFormula: string | null) => {
    setSavingId(pipelineId);
    try {
      const updatedPipelines = pipelines.map(p =>
        p.id === pipelineId ? { ...p, value_field: valueField, value_formula: valueFormula } : p
      );
      await api.patch('/workspace-config/pipelines', updatedPipelines);
      setPipelines(updatedPipelines);
      showToast('success', 'Pipeline value field updated');
    } catch (err: any) {
      showToast('error', err.message || 'Save failed');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div style={{ maxWidth: 800 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: colors.text, margin: '0 0 6px', fontFamily: fonts.sans }}>
        Pipeline Value Field
      </h1>
      <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 28, fontFamily: fonts.sans }}>
        Configure which CRM field represents deal value for each pipeline. Skills use this when
        summing pipeline totals, computing coverage, and generating forecasts.
      </p>

      {toast && (
        <div style={{
          padding: '10px 14px',
          marginBottom: 20,
          borderRadius: 6,
          fontSize: 13,
          fontFamily: fonts.sans,
          background: toast.type === 'success' ? colors.greenSoft : colors.redSoft,
          border: `1px solid ${toast.type === 'success' ? colors.green : colors.red}`,
          color: toast.type === 'success' ? colors.green : colors.red,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16 }}>×</button>
        </div>
      )}

      {loading ? (
        <div style={{ color: colors.textSecondary, fontSize: 13, fontFamily: fonts.sans }}>Loading…</div>
      ) : pipelines.length === 0 ? (
        <div style={{
          padding: 32,
          textAlign: 'center',
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          color: colors.textMuted,
          fontSize: 13,
          fontFamily: fonts.sans,
        }}>
          No pipelines configured. Run workspace config inference first.
        </div>
      ) : (
        <>
          <div style={{
            padding: '10px 14px',
            marginBottom: 20,
            borderRadius: 6,
            background: colors.surfaceRaised,
            border: `1px solid ${colors.border}`,
            fontSize: 12,
            color: colors.textSecondary,
            fontFamily: fonts.sans,
          }}>
            <strong style={{ color: colors.text }}>Available fields</strong> are detected from your CRM data.
            Custom numeric fields from your deals are included automatically.
            Set a <strong style={{ color: colors.text }}>formula</strong> to compute a derived value (e.g. MRR → ARR).
          </div>

          {pipelines.map(p => (
            <PipelineValueEditor
              key={p.id}
              pipeline={p}
              numericFields={numericFields}
              onSave={handleSave}
              saving={savingId === p.id}
            />
          ))}
        </>
      )}
    </div>
  );
}
