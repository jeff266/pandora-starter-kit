import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatTimeAgo } from '../lib/format';
import Skeleton from './Skeleton';
import { useDemoMode } from '../contexts/DemoModeContext';

interface VarianceDriver {
  label: string;
  upsideImpact: number;
  downsideImpact: number;
}

interface MonteCarloPayload {
  p50: number;
  probOfHittingTarget: number | null;
  quota: number | null;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  existingPipelineP50: number;
  projectedPipelineP50: number;
  varianceDrivers: VarianceDriver[];
  iterationsRun: number;
  dealsInSimulation: number;
  closedDealsUsedForFitting: number;
  forecastWindowEnd: string;
  dataQualityTier: 1 | 2 | 3;
  warnings: string[];
  histogram: { bucketMin: number; bucketMax: number; count: number }[];
}

interface MCResponse {
  runId: string;
  generatedAt: string;
  commandCenter: MonteCarloPayload;
}

type PanelState = 'loading' | 'empty' | 'running' | 'error' | 'ready';

function fmtCompact(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function probColor(p: number): string {
  if (p >= 0.7) return colors.green;
  if (p >= 0.4) return colors.orange;
  return colors.red;
}

export default function MonteCarloPanel({ wsId }: { wsId?: string }) {
  const { anon } = useDemoMode();
  const [state, setState] = useState<PanelState>('loading');
  const [data, setData] = useState<MonteCarloPayload | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [triggeringRun, setTriggeringRun] = useState(false);
  const prevWsRef = useRef<string | undefined>(undefined);

  const fetchData = async () => {
    setState('loading');
    try {
      const res: MCResponse = await api.get('/monte-carlo/latest');
      setData(res.commandCenter);
      setGeneratedAt(res.generatedAt);
      setState('ready');
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('404') || msg.includes('No completed')) {
        setData(null);
        setState('empty');
      } else {
        setState('error');
      }
    }
  };

  useEffect(() => {
    if (wsId !== prevWsRef.current) {
      setData(null);
      prevWsRef.current = wsId;
    }
    fetchData();
  }, [wsId]);

  const handleRunForecast = async () => {
    setTriggeringRun(true);
    try {
      await api.post('/skills/monte-carlo-forecast/run');
      setState('running');
      const poll = setInterval(async () => {
        try {
          const res: MCResponse = await api.get('/monte-carlo/latest');
          setData(res.commandCenter);
          setGeneratedAt(res.generatedAt);
          cachedRef.current = true;
          setState('ready');
          setTriggeringRun(false);
          clearInterval(poll);
        } catch {}
      }, 10000);
      setTimeout(() => { clearInterval(poll); if (state === 'running') { setState('empty'); setTriggeringRun(false); } }, 300000);
    } catch {
      setTriggeringRun(false);
      setState('empty');
    }
  };

  if (state === 'loading') {
    return (
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: '18px 20px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Monte Carlo Forecast</div>
          <span style={{ fontSize: 11, color: colors.textMuted }}>Computing 10,000 scenarios...</span>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <Skeleton height={120} style={{ flex: '0 0 40%' }} />
          <Skeleton height={120} style={{ flex: '0 0 35%' }} />
          <Skeleton height={120} style={{ flex: '0 0 25%' }} />
        </div>
      </div>
    );
  }

  if (state === 'running') {
    return (
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: '18px 20px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Monte Carlo Forecast</div>
          <span style={{ fontSize: 11, color: colors.accent }}>Computing 10,000 scenarios...</span>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <Skeleton height={120} style={{ flex: '0 0 40%' }} />
          <Skeleton height={120} style={{ flex: '0 0 35%' }} />
          <Skeleton height={120} style={{ flex: '0 0 25%' }} />
        </div>
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: '18px 20px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>{'\uD83C\uDFB2'}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 4 }}>
          Revenue forecast not yet computed
        </div>
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 14 }}>
          Run a Monte Carlo simulation to see probability-weighted revenue projections
        </div>
        <button
          onClick={handleRunForecast}
          disabled={triggeringRun}
          style={{
            padding: '8px 20px',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: fonts.sans,
            background: colors.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: triggeringRun ? 'not-allowed' : 'pointer',
            opacity: triggeringRun ? 0.6 : 1,
          }}
        >
          {triggeringRun ? 'Starting...' : 'Run forecast'}
        </button>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: '18px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Monte Carlo Forecast</div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>Forecast unavailable</div>
        </div>
        <button
          onClick={() => { cachedRef.current = false; fetchData(); }}
          style={{
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 500,
            fontFamily: fonts.sans,
            background: colors.surfaceRaised,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { p10, p25, p50, p75, p90, probOfHittingTarget, quota, dataQualityTier,
    existingPipelineP50, projectedPipelineP50, varianceDrivers,
    iterationsRun, dealsInSimulation, warnings } = data;

  const existingPct = p50 > 0 ? Math.round((existingPipelineP50 / p50) * 100) : 0;
  const projectedPct = 100 - existingPct;

  const maxDriverImpact = varianceDrivers.reduce((max, d) =>
    Math.max(max, Math.abs(d.upsideImpact), Math.abs(d.downsideImpact)), 1);

  const rangeMin = p10;
  const rangeMax = p90;
  const rangeSpan = rangeMax - rangeMin || 1;
  const pctPos = (val: number) => Math.max(0, Math.min(100, ((val - rangeMin) / rangeSpan) * 100));

  const quotaInRange = quota != null && quota >= rangeMin && quota <= rangeMax;
  const quotaPos = quota != null ? pctPos(quota) : null;

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: '18px 20px',
    }}>
      {dataQualityTier === 1 && (
        <div style={{
          background: colors.yellowSoft,
          border: `1px solid rgba(234,179,8,0.25)`,
          borderRadius: 6,
          padding: '8px 12px',
          marginBottom: 14,
          fontSize: 12,
          color: colors.yellow,
          fontFamily: fonts.sans,
        }}>
          Forecast confidence is low — based on limited historical data. Confidence improves as more deals close.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Monte Carlo Forecast</div>
        <span style={{ fontSize: 11, color: colors.textMuted }}>
          {(iterationsRun || 10000).toLocaleString()} simulations · {dealsInSimulation} deals
          {generatedAt ? ` · updated ${formatTimeAgo(generatedAt)}` : ''}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'stretch' }}>
        <HeadlineColumn
          p10={p10} p50={p50} p90={p90}
          probOfHittingTarget={probOfHittingTarget}
          quota={quota}
          dataQualityTier={dataQualityTier}
          existingPct={existingPct}
          projectedPct={projectedPct}
          existingPipelineP50={existingPipelineP50}
          projectedPipelineP50={projectedPipelineP50}
          anon={anon}
        />

        <div style={{ width: 1, background: colors.border, flexShrink: 0 }} />

        <ProbabilityBand
          p10={p10} p25={p25} p50={p50} p75={p75} p90={p90}
          quota={quota}
          quotaInRange={quotaInRange}
          quotaPos={quotaPos}
          pctPos={pctPos}
          anon={anon}
        />

        <div style={{ width: 1, background: colors.border, flexShrink: 0 }} />

        <VarianceDriversColumn
          drivers={varianceDrivers}
          maxImpact={maxDriverImpact}
          anon={anon}
        />
      </div>
    </div>
  );
}

function HeadlineColumn({ p10, p50, p90, probOfHittingTarget, quota, dataQualityTier,
  existingPct, projectedPct, existingPipelineP50, projectedPipelineP50, anon }: any) {
  const navigate = useNavigate();
  const hasQuota = probOfHittingTarget != null && quota != null;
  const isThinData = dataQualityTier === 1;

  return (
    <div style={{ flex: '0 0 38%', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {hasQuota ? (
        <div>
          <div style={{
            fontSize: 36,
            fontWeight: 700,
            fontFamily: fonts.mono,
            color: probColor(probOfHittingTarget),
            lineHeight: 1.1,
          }}>
            {Math.round(probOfHittingTarget * 100)}%
          </div>
          <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4 }}>
            probability of hitting {fmtCompact(anon.amount(quota))}
          </div>
        </div>
      ) : (
        <div>
          <div style={{
            fontSize: 28,
            fontWeight: 700,
            fontFamily: fonts.mono,
            color: colors.text,
            lineHeight: 1.1,
          }}>
            {isThinData ? '~' : ''}{fmtCompact(anon.amount(p50))}
          </div>
          <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4 }}>most likely outcome</div>
          {isThinData && (
            <span style={{
              display: 'inline-block',
              marginTop: 6,
              fontSize: 10,
              fontWeight: 600,
              background: colors.yellowSoft,
              color: colors.yellow,
              padding: '2px 8px',
              borderRadius: 4,
            }}>
              Limited historical data
            </span>
          )}
          {!isThinData && (
            <div
              onClick={() => navigate('/settings?tab=quotas')}
              style={{ fontSize: 11, color: colors.accent, marginTop: 6, cursor: 'pointer' }}
            >
              Set quota to unlock probability analysis →
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        {[
          { label: 'P10', value: p10 },
          { label: 'P50', value: p50 },
          { label: 'P90', value: p90 },
        ].map(chip => (
          <div key={chip.label} style={{
            background: colors.surfaceRaised,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: '5px 10px',
            fontSize: 11,
            fontFamily: fonts.mono,
            color: colors.text,
          }}>
            <span style={{ color: colors.textMuted, fontSize: 10, marginRight: 4 }}>{chip.label}</span>
            {fmtCompact(anon.amount(chip.value))}
          </div>
        ))}
      </div>

      <div>
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: colors.surfaceRaised }}>
          <div style={{
            width: `${existingPct}%`,
            background: colors.accent,
            borderRadius: existingPct === 100 ? 4 : '4px 0 0 4px',
          }} />
          <div style={{
            width: `${projectedPct}%`,
            background: colors.purple,
            borderRadius: projectedPct === 100 ? 4 : '0 4px 4px 0',
          }} />
        </div>
        <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 4 }}>
          <span style={{ color: colors.accent }}>{existingPct}% existing</span>
          {' · '}
          <span style={{ color: colors.purple }}>{projectedPct}% new pipeline</span>
        </div>
      </div>
    </div>
  );
}

function ProbabilityBand({ p10, p25, p50, p75, p90, quota, quotaInRange, quotaPos, pctPos, anon }: any) {
  const markers = [
    { label: 'P10', value: p10, pos: 0 },
    { label: 'P25', value: p25, pos: pctPos(p25) },
    { label: 'P50', value: p50, pos: pctPos(p50) },
    { label: 'P75', value: p75, pos: pctPos(p75) },
    { label: 'P90', value: p90, pos: 100 },
  ];

  return (
    <div style={{ flex: '0 0 33%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        Probability Band
      </div>

      <div style={{ position: 'relative', height: 60 }}>
        <div style={{
          position: 'absolute',
          top: 20,
          left: 0,
          right: 0,
          height: 20,
          borderRadius: 10,
          background: `linear-gradient(to right, ${colors.red}40, ${colors.yellow}40, ${colors.green}40)`,
        }} />

        <div style={{
          position: 'absolute',
          top: 20,
          left: `${pctPos(p25)}%`,
          width: `${pctPos(p75) - pctPos(p25)}%`,
          height: 20,
          borderRadius: 6,
          background: `linear-gradient(to right, ${colors.yellow}80, ${colors.green}80)`,
        }} />

        {markers.map(m => (
          <div key={m.label} style={{
            position: 'absolute',
            left: `${m.pos}%`,
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}>
            <div style={{
              fontSize: m.label === 'P50' ? 10 : 9,
              fontWeight: m.label === 'P50' ? 700 : 500,
              color: m.label === 'P50' ? colors.text : colors.textMuted,
              marginBottom: 2,
            }}>
              {m.label}
            </div>
            <div style={{
              width: m.label === 'P50' ? 3 : 2,
              height: m.label === 'P50' ? 26 : 20,
              background: m.label === 'P50' ? colors.text : colors.textMuted,
              borderRadius: 1,
              marginTop: m.label === 'P50' ? -3 : 0,
            }} />
            <div style={{
              fontSize: 10,
              fontFamily: fonts.mono,
              color: m.label === 'P50' ? colors.text : colors.textMuted,
              marginTop: 3,
              whiteSpace: 'nowrap',
              fontWeight: m.label === 'P50' ? 600 : 400,
            }}>
              {fmtCompact(anon.amount(m.value))}
            </div>
          </div>
        ))}

        {quota != null && quotaInRange && quotaPos != null && (
          <div style={{
            position: 'absolute',
            left: `${quotaPos}%`,
            transform: 'translateX(-50%)',
            top: 14,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            zIndex: 2,
          }}>
            <div style={{
              fontSize: 9,
              fontWeight: 600,
              color: colors.accent,
              marginBottom: 1,
            }}>
              target
            </div>
            <div style={{
              width: 2,
              height: 32,
              background: colors.accent,
              borderRadius: 1,
              opacity: 0.8,
            }} />
          </div>
        )}

        {quota != null && !quotaInRange && (
          <div style={{
            position: 'absolute',
            left: quota < p10 ? '-4px' : 'calc(100% + 4px)',
            top: 18,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}>
            <div style={{
              fontSize: 9,
              fontWeight: 600,
              color: colors.accent,
            }}>
              target {fmtCompact(anon.amount(quota))}
            </div>
            <div style={{
              width: 0,
              height: 24,
              borderLeft: `2px dashed ${colors.accent}`,
              opacity: 0.6,
            }} />
          </div>
        )}
      </div>
    </div>
  );
}

function VarianceDriversColumn({ drivers, maxImpact, anon }: {
  drivers: VarianceDriver[];
  maxImpact: number;
  anon: any;
}) {
  const top5 = drivers.slice(0, 5);
  const barMaxWidth = 60;

  return (
    <div style={{ flex: '0 0 24%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        What Moves The Number
      </div>

      {top5.length === 0 ? (
        <div style={{ fontSize: 12, color: colors.textMuted }}>No variance data</div>
      ) : (
        top5.map((d, i) => {
          const upWidth = maxImpact > 0 ? (d.upsideImpact / maxImpact) * barMaxWidth : 0;
          const downWidth = maxImpact > 0 ? (Math.abs(d.downsideImpact) / maxImpact) * barMaxWidth : 0;
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 11, color: colors.textSecondary, fontWeight: 500 }}>{d.label}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, height: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', width: barMaxWidth, marginRight: 2 }}>
                  <div style={{
                    width: downWidth,
                    height: 10,
                    background: `${colors.red}90`,
                    borderRadius: '3px 0 0 3px',
                  }} />
                </div>
                <div style={{ width: 1, height: 14, background: colors.border, flexShrink: 0 }} />
                <div style={{ display: 'flex', width: barMaxWidth, marginLeft: 2 }}>
                  <div style={{
                    width: upWidth,
                    height: 10,
                    background: `${colors.green}90`,
                    borderRadius: '0 3px 3px 0',
                  }} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontFamily: fonts.mono }}>
                <span style={{ color: colors.red }}>-{fmtCompact(Math.abs(anon.amount(d.downsideImpact)))}</span>
                <span style={{ color: colors.green }}>+{fmtCompact(anon.amount(d.upsideImpact))}</span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
