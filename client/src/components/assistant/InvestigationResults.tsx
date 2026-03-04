import React from 'react';
import { colors, fonts } from '../../styles/theme';
import { useWorkspace } from '../../context/WorkspaceContext';

interface InvestigationResultsProps {
  skillId: string;
  runId: string;
  completedAt?: string;
  onClose: () => void;
}

const severityColor: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#22c55e',
};

const riskLabel: Record<string, string> = {
  high: 'HIGH RISK',
  medium: 'MEDIUM RISK',
  low: 'LOW RISK',
};

function formatRunTimestamp(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    hour12: true,
  });
}

function humanizeSkillId(id: string): string {
  const map: Record<string, string> = {
    'deal-risk-review':    'Deal Risk Review',
    'data-quality-audit':  'Data Quality Audit',
    'forecast-rollup':     'Forecast Rollup',
  };
  return map[id] ?? id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function InvestigationResults({
  skillId,
  runId,
  completedAt,
  onClose,
}: InvestigationResultsProps) {
  const { currentWorkspace: workspace } = useWorkspace();
  const [results, setResults] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!workspace?.id) return;
    async function fetchResults() {
      try {
        const url = `/api/workspaces/${workspace!.id}/investigation/results/${runId}`;
        console.log('[InvestigationResults] Fetching:', url);
        const response = await fetch(url);
        if (!response.ok) {
          console.error('[InvestigationResults] HTTP error:', response.status);
          setResults({ error: `HTTP ${response.status}` });
          return;
        }
        const data = await response.json();
        setResults(data);
      } catch (err) {
        console.error('[InvestigationResults] Failed to fetch results:', err);
        setResults({ error: 'Network error' });
      } finally {
        setLoading(false);
      }
    }
    fetchResults();
  }, [runId, workspace?.id]);

  if (loading) {
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.7)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}>
        <div style={{
          background: colors.surface, padding: 40, borderRadius: 12,
          fontSize: 16, color: colors.text,
        }}>
          Loading investigation results…
        </div>
      </div>
    );
  }

  const findings: any[] = results?.findings || [];
  const narrativeItems: any[] = results?.narrativeItems || [];
  const dataSources: any[] = results?.dataSources || [];
  const atRisk = findings.filter((f) => f.severity === 'medium' || f.severity === 'high');
  const durationSec = Math.round((results?.durationMs || 0) / 1000);
  const hasContent = findings.length > 0 || narrativeItems.length > 0;
  const summaryText = results?.summary || '';
  const isFallbackSummary = summaryText === 'Investigation completed' || summaryText === '';
  const runTs = completedAt ?? results?.completedAt;

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.7)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          width: '100%',
          maxWidth: 860,
          maxHeight: '85vh',
          overflow: 'auto',
          padding: 28,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontFamily: fonts.sans, fontSize: 20, fontWeight: 700, margin: '0 0 4px 0', color: colors.text }}>
              Investigation Results
            </h2>
            <p style={{ fontFamily: fonts.sans, fontSize: 12, margin: 0, color: colors.textMuted }}>
              {humanizeSkillId(skillId)}
              {runTs && (
                <span style={{ color: colors.textDim }}> · {formatRunTimestamp(runTs)}</span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 24, color: colors.textMuted, cursor: 'pointer', padding: '0 0 0 16px' }}
          >
            ×
          </button>
        </div>

        {/* Summary bar */}
        <div style={{
          padding: '12px 16px', background: colors.surfaceRaised,
          borderRadius: 8, marginBottom: 20,
          borderLeft: `3px solid ${atRisk.length > 0 ? colors.yellow || '#f59e0b' : '#22c55e'}`,
        }}>
          <p style={{ fontFamily: fonts.sans, fontSize: 14, fontWeight: 500, lineHeight: 1.5, margin: 0, color: colors.text }}>
            {summaryText || 'Investigation completed'}
          </p>
        </div>

        {/* AI-recommended actions (narrativeItems from Claude) */}
        {narrativeItems.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontFamily: fonts.sans, fontSize: 15, fontWeight: 600, margin: '0 0 12px 0', color: colors.text }}>
              Recommended Actions ({narrativeItems.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {narrativeItems.map((item: any, i: number) => (
                <div key={i} style={{
                  padding: '12px 14px',
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  borderLeft: `3px solid ${severityColor[item.risk] || '#6b7280'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <span style={{ fontFamily: fonts.sans, fontSize: 13, fontWeight: 600, color: colors.text }}>
                      {item.dealName}
                    </span>
                    <span style={{
                      fontFamily: fonts.sans,
                      fontSize: 10,
                      fontWeight: 700,
                      color: severityColor[item.risk] || '#6b7280',
                      marginLeft: 12,
                      flexShrink: 0,
                    }}>
                      {riskLabel[item.risk] || item.risk?.toUpperCase()}
                    </span>
                  </div>
                  {item.amount && (
                    <div style={{ fontFamily: fonts.sans, fontSize: 11, color: colors.textMuted, marginBottom: 6 }}>
                      ${Number(item.amount).toLocaleString()} · Score {item.riskScore}
                    </div>
                  )}
                  {Array.isArray(item.factors) && item.factors.length > 0 && (
                    <ul style={{ margin: '0 0 8px 0', paddingLeft: 16 }}>
                      {item.factors.map((f: string, fi: number) => (
                        <li key={fi} style={{ fontFamily: fonts.sans, fontSize: 12, color: colors.textSecondary, lineHeight: 1.5 }}>
                          {f}
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.recommendedAction && (
                    <p style={{
                      fontFamily: fonts.sans, fontSize: 12, fontWeight: 500,
                      color: colors.text, margin: 0,
                      padding: '6px 10px',
                      background: 'rgba(255,255,255,0.04)',
                      borderRadius: 6,
                    }}>
                      → {item.recommendedAction}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All deals scored (collapsed list) */}
        {findings.length > 0 && narrativeItems.length === 0 && (
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontFamily: fonts.sans, fontSize: 15, fontWeight: 600, margin: '0 0 12px 0', color: colors.text }}>
              Records Reviewed ({findings.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {findings.map((f: any, i: number) => (
                <div key={i} style={{
                  padding: '10px 12px',
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontFamily: fonts.sans, fontSize: 13, fontWeight: 500, color: colors.text }}>
                      {f.entity_name}
                    </div>
                    {f.message && (
                      <div style={{ fontFamily: fonts.sans, fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                        {f.message}
                      </div>
                    )}
                    {f.owner && (
                      <div style={{ fontFamily: fonts.sans, fontSize: 11, color: colors.textMuted, marginTop: 1 }}>
                        {f.owner}{f.stage ? ` · ${f.stage}` : ''}
                      </div>
                    )}
                  </div>
                  <span style={{
                    fontFamily: fonts.sans, fontSize: 10, fontWeight: 700,
                    color: severityColor[f.severity] || '#6b7280', marginLeft: 12, flexShrink: 0,
                  }}>
                    {riskLabel[f.severity] || f.severity?.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state — only show if summary is also the fallback */}
        {!hasContent && isFallbackSummary && (
          <div style={{
            padding: 24, textAlign: 'center',
            color: colors.textMuted, fontFamily: fonts.sans, fontSize: 14,
          }}>
            No detailed findings were recorded for this run.
          </div>
        )}

        {/* Empty state — has summary text but no structured findings */}
        {!hasContent && !isFallbackSummary && (
          <div style={{
            padding: '16px 0 8px',
            color: colors.textSecondary, fontFamily: fonts.sans, fontSize: 13,
            lineHeight: 1.6,
          }}>
            No structured findings to display — the summary above contains the full result.
          </div>
        )}

        {/* Footer metadata */}
        <div style={{
          paddingTop: 14, borderTop: `1px solid ${colors.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: 8,
        }}>
          <div style={{ fontFamily: fonts.sans, fontSize: 11, color: colors.textMuted, display: 'flex', gap: 12 }}>
            <span>{durationSec > 0 ? `Completed in ${durationSec}s` : 'Completed'}</span>
            {results?.tokenUsage?.total && (
              <span>{Number(results.tokenUsage.total).toLocaleString()} tokens</span>
            )}
            <span style={{ color: colors.textDim }}>Run {runId.slice(0, 8)}…</span>
          </div>
          {dataSources.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {dataSources.map((ds: any, i: number) => (
                <span key={i} style={{
                  fontFamily: fonts.sans, fontSize: 10,
                  padding: '2px 8px', borderRadius: 4,
                  background: ds.connected ? 'rgba(34,197,94,0.12)' : 'rgba(107,114,128,0.15)',
                  color: ds.connected ? '#22c55e' : colors.textMuted,
                  border: `1px solid ${ds.connected ? 'rgba(34,197,94,0.25)' : colors.border}`,
                }}>
                  {ds.source}{ds.connected && ds.records_used ? ` · ${ds.records_used.toLocaleString()}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
