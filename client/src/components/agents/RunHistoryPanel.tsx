import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { CheckCircle, XCircle, Loader2, X, GitCompare, Eye, RotateCcw, ChevronDown } from 'lucide-react';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';
import RunDiffView, { AgentRunSummary } from './RunDiffView';

interface RunHistoryPanelProps {
  agentId: string;
  onRetry: (agentId: string) => void;
}

function formatRunDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function ModeBadge({ mode }: { mode: string | null }) {
  if (!mode) return null;
  const isGoalAware = mode === 'goal_aware';
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 7px',
      borderRadius: 10,
      fontSize: 11,
      fontWeight: 500,
      fontFamily: fonts.sans,
      background: isGoalAware ? 'rgba(20,184,166,0.15)' : colors.surfaceRaised,
      color: isGoalAware ? '#2dd4bf' : colors.textMuted,
      border: `1px solid ${isGoalAware ? 'rgba(20,184,166,0.3)' : colors.border}`,
    }}>
      {isGoalAware ? 'goal-aware' : 'standard'}
    </span>
  );
}

function TrendIndicator({ trend }: { trend: AgentRunSummary['trend'] }) {
  if (!trend) return null;
  const config = {
    improving: { arrow: '↓', label: 'improving', color: '#4ade80' },
    worsening: { arrow: '↑', label: 'worsening', color: '#f87171' },
    stable: { arrow: '—', label: 'stable', color: colors.textMuted },
  }[trend];
  return (
    <span style={{ font: `500 11px ${fonts.sans}`, color: config.color }}>
      {config.arrow} {config.label}
    </span>
  );
}

interface ViewOutputSheetProps {
  run: AgentRunSummary;
  onClose: () => void;
}

function ViewOutputSheet({ run, onClose }: ViewOutputSheetProps) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: '12px 12px 0 0',
        width: '100%', maxWidth: 720,
        maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: `1px solid ${colors.border}`,
          flexShrink: 0,
        }}>
          <div>
            <div style={{ font: `500 15px ${fonts.sans}`, color: colors.text }}>
              Run Output — {formatRunDate(run.started_at)}
            </div>
            <div style={{ font: `400 12px ${fonts.sans}`, color: colors.textMuted, marginTop: 3 }}>
              {run.synthesis_mode === 'goal_aware' ? 'goal-aware' : 'standard'}
              {run.findings_count != null && <> · {run.findings_count} findings</>}
              {run.total_tokens != null && <> · {run.total_tokens.toLocaleString()} tokens</>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px' }}>
          <div style={{
            font: `400 14px ${fonts.sans}`, color: colors.text, lineHeight: 1.7,
          }}>
            <ReactMarkdown
              components={{
                h2: ({ children }) => (
                  <h2 style={{ font: `600 13px ${fonts.sans}`, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '20px 0 8px', borderBottom: `1px solid ${colors.border}`, paddingBottom: 6 }}>{children}</h2>
                ),
                p: ({ children }) => <p style={{ margin: '0 0 10px', lineHeight: 1.7 }}>{children}</p>,
                strong: ({ children }) => <strong style={{ fontWeight: 600, color: colors.text }}>{children}</strong>,
                ol: ({ children }) => <ol style={{ paddingLeft: 20, margin: '0 0 10px' }}>{children}</ol>,
                ul: ({ children }) => <ul style={{ paddingLeft: 20, margin: '0 0 10px' }}>{children}</ul>,
                li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
              }}
            >
              {run.synthesis_output || ''}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RunHistoryPanel({ agentId, onRetry }: RunHistoryPanelProps) {
  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewOutputRun, setViewOutputRun] = useState<AgentRunSummary | null>(null);
  const [diffRun, setDiffRun] = useState<AgentRunSummary | null>(null);

  const loadRuns = useCallback(async (before?: string) => {
    if (!agentId) return;
    const url = `/agents/${agentId}/runs?limit=20${before ? `&before=${encodeURIComponent(before)}` : ''}`;
    const data = await api.get(url);
    return data as { runs: AgentRunSummary[]; has_more: boolean };
  }, [agentId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRuns([]);
    loadRuns().then(data => {
      if (!cancelled && data) {
        setRuns(data.runs);
        setHasMore(data.has_more);
      }
    }).catch(err => {
      console.error('Failed to load run history:', err);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [loadRuns]);

  async function handleLoadMore() {
    if (runs.length === 0) return;
    const oldest = runs[runs.length - 1];
    setLoadingMore(true);
    try {
      const data = await loadRuns(oldest.started_at);
      if (data) {
        setRuns(prev => [...prev, ...data.runs]);
        setHasMore(data.has_more);
      }
    } catch (err) {
      console.error('Failed to load more runs:', err);
    } finally {
      setLoadingMore(false);
    }
  }

  const goalAwareRuns = runs.filter(r => r.synthesis_mode === 'goal_aware');

  function canDiff(run: AgentRunSummary): AgentRunSummary | null {
    if (run.synthesis_mode !== 'goal_aware') return null;
    const idx = goalAwareRuns.findIndex(r => r.id === run.id);
    if (idx < 0 || idx === goalAwareRuns.length - 1) return null;
    return goalAwareRuns[idx + 1];
  }

  if (loading) {
    return (
      <div style={{ padding: '16px 0', display: 'flex', alignItems: 'center', gap: 8, font: `400 13px ${fonts.sans}`, color: colors.textMuted }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading run history…
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div style={{ padding: '14px 16px', background: colors.surfaceRaised, borderRadius: 8, font: `400 13px ${fonts.sans}`, color: colors.textMuted }}>
        No runs yet. Click Run Now to generate your first briefing.
      </div>
    );
  }

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <div style={{ font: `600 11px ${fonts.sans}`, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          Run History
        </div>

        <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
          {runs.map((run, idx) => {
            const prevGoalAware = canDiff(run);

            return (
              <div key={run.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '11px 14px',
                borderBottom: idx < runs.length - 1 ? `1px solid ${colors.border}` : 'none',
                background: colors.surface,
              }}>
                <div style={{ paddingTop: 2, flexShrink: 0 }}>
                  {run.status === 'running' ? (
                    <Loader2 size={15} style={{ color: colors.accent, animation: 'spin 1s linear infinite' }} />
                  ) : run.status === 'completed' || run.status === 'success' ? (
                    <CheckCircle size={15} style={{ color: '#4ade80' }} />
                  ) : (
                    <XCircle size={15} style={{ color: '#f87171' }} />
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: run.status === 'failed' ? 0 : 6 }}>
                    <span style={{ font: `500 13px ${fonts.sans}`, color: colors.text }}>
                      {formatRunDate(run.started_at)}
                    </span>
                    {run.status !== 'failed' && <ModeBadge mode={run.synthesis_mode} />}
                    {run.findings_count != null && run.status !== 'failed' && (
                      <span style={{ font: `400 12px ${fonts.sans}`, color: colors.textSecondary }}>
                        {run.findings_count} finding{run.findings_count !== 1 ? 's' : ''}
                      </span>
                    )}
                    {run.trend && <TrendIndicator trend={run.trend} />}
                  </div>

                  {run.error_message && (
                    <div style={{ font: `400 12px ${fonts.sans}`, color: '#f87171', marginTop: 2 }}>
                      {run.error_message}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 6, marginTop: run.status === 'failed' ? 8 : 0 }}>
                    {run.synthesis_output && (
                      <button
                        onClick={() => setViewOutputRun(run)}
                        style={btnAction}
                      >
                        <Eye size={11} /> View Output
                      </button>
                    )}
                    {prevGoalAware && (
                      <button
                        onClick={() => setDiffRun(run)}
                        style={btnAction}
                      >
                        <GitCompare size={11} /> Diff ↕
                      </button>
                    )}
                    {(run.status === 'failed') && (
                      <button
                        onClick={() => onRetry(agentId)}
                        style={{ ...btnAction, color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}
                      >
                        <RotateCcw size={11} /> Retry
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {hasMore && (
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              marginTop: 8, padding: '7px 12px',
              font: `400 12px ${fonts.sans}`, color: colors.textSecondary,
              background: 'none', border: `1px solid ${colors.border}`,
              borderRadius: 6, cursor: 'pointer', width: '100%',
              justifyContent: 'center',
            }}
          >
            {loadingMore ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <ChevronDown size={12} />}
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>

      {viewOutputRun && (
        <ViewOutputSheet run={viewOutputRun} onClose={() => setViewOutputRun(null)} />
      )}

      {diffRun && (() => {
        const prev = canDiff(diffRun);
        return prev ? (
          <RunDiffView
            current={diffRun}
            previous={prev}
            onClose={() => setDiffRun(null)}
          />
        ) : null;
      })()}
    </>
  );
}

const btnAction: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 8px',
  font: `400 11px ${fonts.sans}`,
  color: colors.textSecondary,
  background: 'none',
  border: `1px solid ${colors.border}`,
  borderRadius: 5,
  cursor: 'pointer',
};
