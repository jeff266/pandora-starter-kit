import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../../styles/theme';
import { api, getAuthToken } from '../../lib/api';
import { useWorkspace } from '../../context/WorkspaceContext';

interface SourceDimension {
  dimension_key: string;
  dimension_label: string;
  confirmed_value: number;
  condition_count: number;
  confirmed: boolean;
}

interface CopyResult {
  dimensions_copied: number;
  stage_mappings_copied: number;
  errors: string[];
}

type Step = 'workspace' | 'dimensions' | 'result';

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

interface DimensionCopySectionProps {
  onCopyComplete?: () => void;
}

export default function DimensionCopySection({ onCopyComplete }: DimensionCopySectionProps) {
  const navigate = useNavigate();
  const { workspaces, currentWorkspace } = useWorkspace();
  const currentWsId = currentWorkspace?.id ?? '';

  const otherWorkspaces = workspaces.filter(w => w.id !== currentWsId);

  const [step, setStep]           = useState<Step>('workspace');
  const [sourceId, setSourceId]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [dimensions, setDimensions] = useState<SourceDimension[]>([]);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [copyQuota, setCopyQuota]   = useState(false);
  const [copyTargets, setCopyTargets] = useState(true);
  const [result, setResult]       = useState<CopyResult | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const handleLoadDimensions = useCallback(async () => {
    if (!sourceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${sourceId}/calibration-status`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (!res.ok) throw new Error(`Failed to load: HTTP ${res.status}`);
      const statusData = await res.json();

      const dims: SourceDimension[] = (statusData.dimension_details ?? []).filter(
        (d: SourceDimension) => d.confirmed
      );

      if (dims.length === 0) {
        setError('This workspace has no confirmed dimensions to copy.');
        setDimensions([]);
        return;
      }
      setDimensions(dims);
      setSelected(new Set(dims.map((d: SourceDimension) => d.dimension_key)));
      setStep('dimensions');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dimensions from source workspace.');
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  const executeCopy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/dimensions/copy-from', {
        source_workspace_id: sourceId,
        options: {
          dimension_keys: Array.from(selected),
          copy_quota: copyQuota,
          copy_targets: copyTargets,
          reset_confirmed: true,
        },
      }) as CopyResult;
      setResult(res);
      setStep('result');
      onCopyComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copy failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [sourceId, selected, copyQuota, copyTargets, onCopyComplete]);

  const handleStartReview = () => {
    navigate('/');
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('pandora:open-ask', {
        detail: { initialMessage: 'Continue my calibration' },
      }));
    }, 200);
  };

  const SECTION_HEADER: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    margin: '0 0 4px',
  };

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      fontFamily: fonts.sans,
    }}>
      <div style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: 12 }}>
        <div style={SECTION_HEADER}>Copy from Another Workspace</div>
        <p style={{ fontSize: 13, color: colors.textSecondary, margin: 0 }}>
          Copy confirmed dimension definitions from another workspace you have access to.
          Copied dimensions will be unconfirmed until you review them.
        </p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 6, fontSize: 13, color: '#f87171' }}>
          {error}
        </div>
      )}

      {step === 'workspace' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: colors.textMuted, display: 'block', marginBottom: 6 }}>
              Source workspace
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select
                value={sourceId}
                onChange={e => setSourceId(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 200,
                  padding: '8px 12px',
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  fontSize: 13,
                  color: colors.text,
                  fontFamily: fonts.sans,
                }}
              >
                <option value="">— select a workspace —</option>
                {otherWorkspaces.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              <button
                onClick={handleLoadDimensions}
                disabled={!sourceId || loading}
                style={{
                  ...primaryBtn,
                  opacity: !sourceId || loading ? 0.6 : 1,
                  cursor: !sourceId || loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Loading…' : 'Load dimensions →'}
              </button>
            </div>
            {otherWorkspaces.length === 0 && (
              <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 8, fontStyle: 'italic' }}>
                No other workspaces found. You need access to at least two workspaces to use this feature.
              </p>
            )}
          </div>
        </div>
      )}

      {step === 'dimensions' && dimensions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
            Select dimensions to copy:
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dimensions.map(dim => {
              const isChecked = selected.has(dim.dimension_key);
              return (
                <label
                  key={dim.dimension_key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                    padding: '8px 12px',
                    background: isChecked ? 'rgba(20,184,166,0.06)' : colors.surfaceRaised,
                    borderRadius: 6,
                    border: `1px solid ${isChecked ? '#14B8A6' : colors.border}`,
                    transition: 'all 0.1s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={e => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(dim.dimension_key);
                      else next.delete(dim.dimension_key);
                      setSelected(next);
                    }}
                    style={{ accentColor: '#14B8A6', width: 14, height: 14 }}
                  />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: colors.text }}>{dim.dimension_label}</span>
                  {dim.confirmed_value > 0 && (
                    <span style={{ fontSize: 12, color: '#14B8A6', fontWeight: 500 }}>
                      {fmtCurrency(dim.confirmed_value)} confirmed
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: colors.textMuted }}>
                    ({dim.condition_count ?? 0} condition{(dim.condition_count ?? 0) !== 1 ? 's' : ''})
                  </span>
                </label>
              );
            })}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
            <div style={{ fontSize: 12, color: colors.textMuted, fontWeight: 600 }}>Options</div>
            {([
              { label: 'Copy quota targets', value: copyQuota, set: setCopyQuota },
              { label: 'Copy coverage / win rate targets', value: copyTargets, set: setCopyTargets },
            ] as const).map(({ label, value, set }) => (
              <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: colors.textSecondary, cursor: 'pointer' }}>
                <input type="checkbox" checked={value} onChange={e => set(e.target.checked)} style={{ accentColor: '#14B8A6' }} />
                {label}
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setStep('workspace'); setDimensions([]); setSelected(new Set()); setError(null); }} style={ghostBtn}>Cancel</button>
            <button
              onClick={executeCopy}
              disabled={selected.size === 0 || loading}
              style={{
                ...primaryBtn,
                opacity: selected.size === 0 || loading ? 0.6 : 1,
                cursor: selected.size === 0 || loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Copying…' : `Copy selected (${selected.size}) →`}
            </button>
          </div>
        </div>
      )}

      {step === 'result' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#22c55e' }}>✓ Copy complete</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <div style={{ color: colors.textSecondary }}>
              {result.dimensions_copied} dimension{result.dimensions_copied !== 1 ? 's' : ''} copied
            </div>
            <div style={{ color: colors.textSecondary }}>
              {result.stage_mappings_copied} stage mapping{result.stage_mappings_copied !== 1 ? 's' : ''} copied
            </div>
            {result.errors.map((e, i) => (
              <div key={i} style={{ color: '#f87171', fontSize: 12 }}>{e}</div>
            ))}
          </div>
          <p style={{ fontSize: 13, color: colors.textMuted, margin: 0 }}>
            Copied dimensions are unconfirmed. Review and confirm each one via the calibration interview.
          </p>
          <button onClick={handleStartReview} style={primaryBtn}>
            Start review →
          </button>
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '8px 16px',
  background: '#14B8A6',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const ghostBtn: React.CSSProperties = {
  padding: '8px 16px',
  background: 'transparent',
  color: '#64748b',
  border: '1px solid #334155',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
