import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatDateTime, formatTimeAgo } from '../lib/format';
import Skeleton from '../components/Skeleton';

export default function SkillRunsPage() {
  const { skillId } = useParams<{ skillId: string }>();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  useEffect(() => {
    if (!skillId) return;
    api.get(`/skills/${skillId}/runs`)
      .then(data => setRuns(Array.isArray(data) ? data : data.runs || []))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, [skillId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={48} />)}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => navigate('/skills')}
        style={{ fontSize: 12, color: colors.accent, background: 'none', marginBottom: 16 }}
      >
        &larr; Back to Skills
      </button>

      <h2 style={{ fontSize: 15, fontWeight: 600, color: colors.text, marginBottom: 16 }}>
        {skillId}
      </h2>

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '160px 150px 100px 100px 100px',
          padding: '10px 16px',
          borderBottom: `1px solid ${colors.border}`,
          fontSize: 11,
          fontWeight: 600,
          color: colors.textDim,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          <span>Run ID</span>
          <span>Started</span>
          <span>Duration</span>
          <span>Status</span>
          <span>Trigger</span>
        </div>

        {runs.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
            No runs recorded for this skill
          </div>
        ) : (
          runs.map((run, i) => {
            const isExpanded = expandedRun === (run.run_id || run.id);
            const duration = run.duration_ms
              ? `${(run.duration_ms / 1000).toFixed(1)}s`
              : run.started_at && run.completed_at
                ? `${((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1)}s`
                : '--';
            const statusColor = run.status === 'completed' ? colors.green : run.status === 'failed' ? colors.red : colors.yellow;

            return (
              <React.Fragment key={run.run_id || run.id || i}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '160px 150px 100px 100px 100px',
                    padding: '10px 16px',
                    borderBottom: `1px solid ${colors.border}`,
                    cursor: 'pointer',
                    alignItems: 'center',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => setExpandedRun(isExpanded ? null : (run.run_id || run.id))}
                >
                  <span style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.textSecondary }}>
                    {(run.run_id || run.id || '').slice(0, 12)}...
                  </span>
                  <span style={{ fontSize: 12, color: colors.textSecondary }}>
                    {run.started_at ? formatDateTime(run.started_at) : '--'}
                  </span>
                  <span style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.textMuted }}>
                    {duration}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                    background: `${statusColor}15`, color: statusColor,
                    justifySelf: 'start', textTransform: 'capitalize',
                  }}>
                    {run.status || 'unknown'}
                  </span>
                  <span style={{ fontSize: 11, color: colors.textMuted, textTransform: 'capitalize' }}>
                    {run.trigger || 'manual'}
                  </span>
                </div>

                {isExpanded && (
                  <div style={{
                    padding: 16,
                    background: colors.surfaceRaised,
                    borderBottom: `1px solid ${colors.border}`,
                  }}>
                    <RunOutput run={run} />
                  </div>
                )}
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}

function RunOutput({ run }: { run: any }) {
  const narrative = run.result?.narrative || run.result?.output || run.result?.synthesize?.narrative;
  const error = run.error || run.result?.error;

  if (error) {
    return (
      <div style={{ fontSize: 12, color: colors.red, fontFamily: fonts.mono, whiteSpace: 'pre-wrap' }}>
        {typeof error === 'string' ? error : JSON.stringify(error, null, 2)}
      </div>
    );
  }

  if (narrative) {
    return (
      <div style={{ fontSize: 13, color: colors.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
        {narrative}
      </div>
    );
  }

  if (run.result) {
    return (
      <pre style={{ fontSize: 11, color: colors.textSecondary, fontFamily: fonts.mono, whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>
        {JSON.stringify(run.result, null, 2).slice(0, 3000)}
      </pre>
    );
  }

  return <span style={{ fontSize: 12, color: colors.textMuted }}>No output available</span>;
}
