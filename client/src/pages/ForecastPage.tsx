import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { useWorkspace } from '../context/WorkspaceContext';
import { useForecastAnnotations } from '../hooks/useForecastAnnotations';
import { useDemoMode } from '../contexts/DemoModeContext';
import SectionErrorBoundary from '../components/SectionErrorBoundary';
import {
  MetricCards,
  ForecastChart,
  RepTable,
  CoverageBars,
  PipeGenChart,
  DrillDownPanel,
  ChartInsightsSidebar,
  AnnotationsPanel,
} from '../components/forecast';
import type { RepRow } from '../components/forecast/RepTable';

interface SnapshotData {
  run_id: string;
  snapshot_date: string;
  scope_id: string | null;
  stage_weighted_forecast: number | null;
  category_weighted_forecast: number | null;
  monte_carlo_p50: number | null;
  monte_carlo_p25: number | null;
  monte_carlo_p75: number | null;
  monte_carlo_p10: number | null;
  monte_carlo_p90: number | null;
  attainment: number | null;
  quota: number | null;
  total_pipeline: number | null;
  weighted_pipeline: number | null;
  deal_count: number | null;
  pipe_gen_this_week: number | null;
  pipe_gen_avg: number | null;
  coverage_ratio: number | null;
  by_rep: any[];
  annotation_count: number;
}

function formatCurrency(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

export default function ForecastPage() {
  const { currentWorkspace } = useWorkspace();
  const { anon } = useDemoMode();
  const navigate = useNavigate();
  const wsId = currentWorkspace?.id || '';

  const [snapshots, setSnapshots] = useState<SnapshotData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAI, setShowAI] = useState(true);
  const [drillDown, setDrillDown] = useState<{ open: boolean; title: string; deals: any[] }>({ open: false, title: '', deals: [] });

  const { annotations, grouped, dismiss, snooze } = useForecastAnnotations(wsId);

  useEffect(() => {
    if (!wsId) return;
    setLoading(true);
    api.get('/forecast/snapshots?limit=13')
      .then((data: any) => {
        setSnapshots(data.snapshots || []);
        setError(null);
      })
      .catch((err: any) => {
        console.error('[ForecastPage] Failed to load snapshots:', err);
        setError('Failed to load forecast data');
      })
      .finally(() => setLoading(false));
  }, [wsId]);

  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
  const quota = latest?.quota || null;

  const currentMetrics = useMemo(() => {
    if (!latest) return null;
    return {
      snapshot_date: latest.snapshot_date,
      mc_p50: latest.monte_carlo_p50 ?? undefined,
      mc_p25: latest.monte_carlo_p25 ?? undefined,
      mc_p75: latest.monte_carlo_p75 ?? undefined,
      closed_won: latest.attainment ?? undefined,
      pipeline_total: latest.total_pipeline ?? undefined,
      quota: latest.quota ?? undefined,
      pipe_gen: latest.pipe_gen_this_week ?? undefined,
      forecast_weighted: latest.stage_weighted_forecast ?? undefined,
      category_weighted: latest.category_weighted_forecast ?? undefined,
    };
  }, [latest]);

  const previousMetrics = useMemo(() => {
    if (!previous) return null;
    return {
      snapshot_date: previous.snapshot_date,
      mc_p50: previous.monte_carlo_p50 ?? undefined,
      mc_p25: previous.monte_carlo_p25 ?? undefined,
      mc_p75: previous.monte_carlo_p75 ?? undefined,
      closed_won: previous.attainment ?? undefined,
      pipeline_total: previous.total_pipeline ?? undefined,
      quota: previous.quota ?? undefined,
      pipe_gen: previous.pipe_gen_this_week ?? undefined,
      forecast_weighted: previous.stage_weighted_forecast ?? undefined,
      category_weighted: previous.category_weighted_forecast ?? undefined,
    };
  }, [previous]);

  const repRows: RepRow[] = useMemo(() => {
    if (!latest?.by_rep) return [];
    return latest.by_rep.map((r: any) => ({
      rep_name: anon.person(r.rep_name || r.owner_name || 'Unknown'),
      rep_email: r.rep_email || r.owner_email || '',
      deals: r.deal_count || r.deals || 0,
      pipeline: r.total_pipeline || r.pipeline || 0,
      stage_weighted: r.stage_weighted || 0,
      category_weighted: r.category_weighted || 0,
      mc_p50: r.mc_p50 || 0,
      actual: r.closed_won || r.actual || 0,
      quota: r.quota || 0,
    }));
  }, [latest, anon]);

  const coverageQuarters = useMemo(() => {
    if (!latest) return [];
    const q = latest.quota || 0;
    const p = latest.total_pipeline || 0;
    const now = new Date();
    const qLabel = `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`;
    return [{ label: qLabel, pipeline: p, quota: q }];
  }, [latest]);

  const pipeGenWeeks = useMemo(() => {
    return snapshots.slice(-8).map(s => ({
      week_label: new Date(s.snapshot_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      created: s.pipe_gen_this_week || 0,
    }));
  }, [snapshots]);

  const weekNum = useMemo(() => {
    const now = new Date();
    const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    return Math.ceil(((now.getTime() - qStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1);
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.sans }}>Forecast</h1>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ flex: 1, height: 80, background: colors.surfaceRaised, borderRadius: 8, animation: 'pulse 1.5s infinite' }} />
          ))}
        </div>
        <div style={{ height: 300, background: colors.surfaceRaised, borderRadius: 10, animation: 'pulse 1.5s infinite' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ fontSize: 14, color: colors.red, fontFamily: fonts.sans }}>{error}</p>
        <button
          onClick={() => window.location.reload()}
          style={{ marginTop: 12, padding: '6px 16px', background: colors.accent, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: fonts.sans }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.sans }}>Forecast</h1>
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 60,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📈</div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 8, fontFamily: fonts.sans }}>
            No forecast data yet
          </h2>
          <p style={{ fontSize: 13, color: colors.textSecondary, maxWidth: 400, margin: '0 auto 20px', fontFamily: fonts.sans }}>
            Forecast tracking starts after your first weekly pipeline review. Run a forecast skill to capture your first snapshot.
          </p>
          <button
            onClick={() => navigate('/skills')}
            style={{
              padding: '8px 20px',
              background: colors.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              fontFamily: fonts.sans,
            }}
          >
            Go to Skills
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>Forecast</h1>
          <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.mono }}>
            Week {weekNum} of 13
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans }}>
            <span>✨ AI Insights</span>
            <div
              onClick={() => setShowAI(!showAI)}
              style={{
                width: 34,
                height: 18,
                borderRadius: 9,
                background: showAI ? colors.accent : colors.surfaceHover,
                position: 'relative',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              <div style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: '#fff',
                position: 'absolute',
                top: 2,
                left: showAI ? 18 : 2,
                transition: 'left 0.2s',
              }} />
            </div>
          </label>
        </div>
      </div>

      <SectionErrorBoundary fallbackMessage="Failed to load metric cards.">
        <MetricCards current={currentMetrics} previous={previousMetrics} />
      </SectionErrorBoundary>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SectionErrorBoundary fallbackMessage="Failed to load forecast chart.">
            <ForecastChart
              snapshots={snapshots}
              quota={quota}
              onPointClick={(snapshot, metric) => {
                console.log('Chart point clicked:', metric, snapshot.snapshot_date);
              }}
            />
          </SectionErrorBoundary>
        </div>

        {showAI && grouped.chart.length > 0 && (
          <div style={{ width: 300, flexShrink: 0 }}>
            <SectionErrorBoundary fallbackMessage="Failed to load chart insights.">
              <ChartInsightsSidebar
                annotations={[...grouped.chart, ...grouped.global]}
                onDismiss={dismiss}
                onSnooze={snooze}
              />
            </SectionErrorBoundary>
          </div>
        )}
      </div>

      {showAI && (grouped.deals.length > 0 || repRows.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: repRows.length > 0 ? '1fr 320px' : '1fr', gap: 16 }}>
          {repRows.length > 0 && (
            <SectionErrorBoundary fallbackMessage="Failed to load rep table.">
              <RepTable
                reps={repRows}
                annotations={showAI ? grouped.reps : []}
              />
            </SectionErrorBoundary>
          )}

          {grouped.deals.length > 0 && (
            <div style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              padding: 16,
            }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 12, fontFamily: fonts.sans }}>
                Deal Risk Alerts
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {grouped.deals.map(a => (
                  <div
                    key={a.id}
                    style={{
                      padding: '10px 12px',
                      background: colors.surfaceRaised,
                      border: `1px solid ${colors.border}`,
                      borderLeft: `3px solid ${a.severity === 'critical' ? colors.red : colors.yellow}`,
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: a.severity === 'critical' ? '#fca5a5' : '#fde68a', fontFamily: fonts.sans }}>
                      {a.title}
                    </div>
                    <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 4, fontFamily: fonts.sans }}>
                      {a.body}
                    </div>
                    {a.impact && (
                      <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4, fontFamily: fonts.sans }}>
                        Impact: {a.impact}
                      </div>
                    )}
                    {a.anchor.type === 'deal' && (
                      <button
                        onClick={() => navigate(`/deals/${a.anchor.type === 'deal' ? (a.anchor as any).deal_id : ''}`)}
                        style={{
                          fontSize: 11,
                          color: colors.accent,
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          marginTop: 6,
                          fontFamily: fonts.sans,
                        }}
                      >
                        View deal →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!showAI && repRows.length > 0 && (
        <SectionErrorBoundary fallbackMessage="Failed to load rep table.">
          <RepTable reps={repRows} annotations={[]} />
        </SectionErrorBoundary>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {coverageQuarters.length > 0 && (
          <SectionErrorBoundary fallbackMessage="Failed to load coverage bars.">
            <CoverageBars
              quarters={coverageQuarters}
              annotations={showAI ? grouped.coverage : []}
            />
          </SectionErrorBoundary>
        )}

        {pipeGenWeeks.length > 0 && (
          <SectionErrorBoundary fallbackMessage="Failed to load pipe gen chart.">
            <PipeGenChart weeks={pipeGenWeeks} />
          </SectionErrorBoundary>
        )}
      </div>

      {showAI && annotations.length > 0 && grouped.chart.length === 0 && grouped.deals.length === 0 && (
        <SectionErrorBoundary fallbackMessage="Failed to load annotations.">
          <AnnotationsPanel
            workspaceId={wsId}
            defaultExpanded={true}
            showToggle={true}
          />
        </SectionErrorBoundary>
      )}

      <DrillDownPanel
        open={drillDown.open}
        onClose={() => setDrillDown({ open: false, title: '', deals: [] })}
        title={drillDown.title}
        deals={drillDown.deals}
        onDealClick={(dealId) => navigate(`/deals/${dealId}`)}
      />
    </div>
  );
}
