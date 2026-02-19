import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatTimeAgo } from '../lib/format';
import Skeleton from './Skeleton';
import { useDemoMode } from '../contexts/DemoModeContext';

interface TornadoAssumption {
  label: string;
  value: string;
  low: string;
  high: string;
  unit: 'currency' | 'percent' | 'days' | 'count';
  implication: string;
  skew: 'upside_heavy' | 'downside_heavy' | 'balanced';
}

interface VarianceDriver {
  label: string;
  upsideImpact: number;
  downsideImpact: number;
  assumption?: TornadoAssumption;
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
  pipelineFilter?: string | null;
  pipelineType?: string;
  componentBMethod?: string;
}

interface MCResponse {
  runId: string;
  generatedAt: string;
  commandCenter: MonteCarloPayload;
}

interface PipelineOption {
  name: string;
  dealCount: number;
  totalValue: number;
  inferredType: 'new_business' | 'renewal' | 'expansion';
}

type PanelState = 'loading' | 'empty' | 'running' | 'error' | 'ready';

const INFERRED_TYPE_LABELS: Record<string, string> = {
  new_business: 'New Business',
  renewal: 'Renewal',
  expansion: 'Expansion',
};

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

function SpinnerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: 'mc-spin 1s linear infinite' }}>
      <style>{`@keyframes mc-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="10" stroke={colors.textMuted} strokeWidth="2.5" strokeDasharray="31.4 31.4" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

interface QueryResponse {
  answer: string;
  queryType: string;
  data: any;
  confidence: number;
  followUps: string[];
}

interface QueryHistoryItem {
  id?: string;
  question: string;
  intentType?: string;
  answer: string;
  createdAt: string;
}

interface RunSummary {
  runId: string;
  createdAt: string;
  pipelineFilter: string | null;
  pipelineType: string | null;
  p50: number | null;
  p10: number | null;
  p90: number | null;
  dealsInSimulation: number | null;
}

const SUGGESTED_QUESTIONS = [
  { label: 'Which deals must close to hit target?', category: 'analysis' },
  { label: 'What if our win rate improves 20%?',    category: 'what-if'  },
  { label: 'What happens if we close the biggest deal?', category: 'what-if' },
];

const WHAT_IF_EXAMPLES = [
  "What if win rate drops 30%?",
  "What if we add $500K in pipeline?",
  "What if top 3 deals slip to next quarter?",
];

export default function MonteCarloPanel({ wsId, activePipeline }: { wsId?: string; activePipeline?: string }) {
  const { anon } = useDemoMode();
  const [state, setState] = useState<PanelState>('loading');
  const [data, setData] = useState<MonteCarloPayload | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [triggeringRun, setTriggeringRun] = useState(false);
  const prevWsRef = useRef<string | undefined>(undefined);
  const prevPipelineRef = useRef<string | null | undefined>(undefined);

  const [mcPipelines, setMcPipelines] = useState<PipelineOption[]>([]);
  const selectedPipeline = activePipeline && activePipeline !== 'default' ? activePipeline : null;
  const selectedPipelineType = mcPipelines.find(p => p.name === selectedPipeline)?.inferredType || null;

  // Query section state
  const [question, setQuestion] = useState('');
  const [queryAnswer, setQueryAnswer] = useState<QueryResponse | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  // Session management for conversation history
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const [turns, setTurns] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Run history state
  const [runHistory, setRunHistory] = useState<RunSummary[]>([]);
  const [runsOpen, setRunsOpen] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const fetchMcPipelines = async () => {
    try {
      const res = await api.get('/monte-carlo/pipelines');
      setMcPipelines(Array.isArray(res) ? res : (res?.pipelines || []));
    } catch {
      setMcPipelines([]);
    }
  };

  // Auto-scroll chat to bottom when new turns arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const fetchData = async (pipeline?: string | null, runId?: string | null) => {
    setState('loading');
    try {
      let path = '/monte-carlo/latest';
      if (runId) path = `/monte-carlo/latest?runId=${encodeURIComponent(runId)}`;
      else if (pipeline) path = `/monte-carlo/latest?pipeline=${encodeURIComponent(pipeline)}`;
      const res: MCResponse = await api.get(path);
      setData(res.commandCenter);
      setGeneratedAt(res.generatedAt);
      setActiveRunId(res.runId ?? null);
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
    fetchMcPipelines();
    const pipelineArg = activePipeline && activePipeline !== 'all' ? activePipeline : null;
    fetchData(pipelineArg);
    prevPipelineRef.current = pipelineArg;
    api.get('/monte-carlo/runs?limit=20')
      .then((res: any) => setRunHistory(res?.runs || []))
      .catch(() => {});
  }, [wsId]);

  useEffect(() => {
    if (prevPipelineRef.current === undefined) {
      prevPipelineRef.current = selectedPipeline;
      return;
    }
    if (prevPipelineRef.current !== selectedPipeline) {
      sessionIdRef.current = crypto.randomUUID();
      setTurns([]);
      setQueryAnswer(null);
      setData(null);
      fetchData(selectedPipeline);
      prevPipelineRef.current = selectedPipeline;
    }
  }, [selectedPipeline]);

  const handleRunForecast = async () => {
    setTriggeringRun(true);
    try {
      await api.post('/skills/monte-carlo-forecast/run', { params: { pipelineFilter: selectedPipeline, pipelineType: selectedPipelineType } });
      setState('running');
      const poll = setInterval(async () => {
        try {
          const path = selectedPipeline ? `/monte-carlo/latest?pipeline=${encodeURIComponent(selectedPipeline)}` : '/monte-carlo/latest';
          const res: MCResponse = await api.get(path);
          setData(res.commandCenter);
          setGeneratedAt(res.generatedAt);
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

  // Fetch query history on mount / workspace change
  useEffect(() => {
    if (!wsId) return;
    api.get('/chat/history?surface=mc_query&limit=5')
      .then((res: any) => setHistory(res?.queries || []))
      .catch(() => {});
  }, [wsId]);

  const submitQuestion = useCallback(async (q: string) => {
    if (!q.trim() || queryLoading) return;
    setQueryLoading(true);
    setQueryError(null);
    try {
      const res = await api.post('/monte-carlo/query', {
        question: q.trim(),
        pipelineId: selectedPipeline ?? null,
        sessionId: sessionIdRef.current,
        conversationHistory: turns,
      }) as QueryResponse;
      setQueryAnswer(res);
      setQuestion('');
      // Accumulate turns for follow-up context — only answer text, not raw data
      setTurns(prev => [
        ...prev,
        { role: 'user', content: q.trim() },
        { role: 'assistant', content: res.answer },
      ]);
      setHistory(prev => [{
        question: q.trim(),
        answer: res.answer,
        createdAt: new Date().toISOString(),
      }, ...prev].slice(0, 5));
    } catch {
      setQueryError('Something went wrong. Try again.');
    } finally {
      setQueryLoading(false);
    }
  }, [queryLoading, selectedPipeline, turns]);

  const pipelineBadge = selectedPipeline ? (
    <span style={{
      display: 'inline-block',
      fontSize: 11,
      fontWeight: 500,
      background: colors.surfaceRaised,
      color: colors.textSecondary,
      border: `1px solid ${colors.border}`,
      borderRadius: 6,
      padding: '3px 8px',
      maxWidth: 220,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}>
      {selectedPipeline}
    </span>
  ) : null;

  const pipelineContextBadge = data?.pipelineFilter ? (
    <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
      <span style={{
        display: 'inline-block',
        fontSize: 10,
        fontWeight: 600,
        background: colors.purpleSoft,
        color: colors.purple,
        padding: '2px 8px',
        borderRadius: 4,
      }}>
        {data.pipelineFilter}
      </span>
      {data.pipelineType && (
        <span style={{
          display: 'inline-block',
          fontSize: 10,
          fontWeight: 600,
          background: colors.accentSoft,
          color: colors.accent,
          padding: '2px 8px',
          borderRadius: 4,
        }}>
          {INFERRED_TYPE_LABELS[data.pipelineType] || data.pipelineType}
        </span>
      )}
    </div>
  ) : null;

  if (state === 'loading') {
    return (
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: '18px 20px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Monte Carlo Forecast</div>
            {pipelineBadge}
          </div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Monte Carlo Forecast</div>
            {pipelineBadge}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: colors.accent }}>Computing 10,000 scenarios...</span>
            <SpinnerIcon size={14} />
          </div>
        </div>
        {pipelineContextBadge}
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
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          Monte Carlo Forecast {pipelineBadge}
        </div>
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
        <div style={{ borderTop: `1px solid #1A1F2B`, marginTop: 16, paddingTop: 16 }}>
          <div style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic' }}>
            Ask questions once a forecast has been run.
          </div>
        </div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Monte Carlo Forecast</div>
            {pipelineBadge}
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>Forecast unavailable</div>
        </div>
        <button
          onClick={() => { fetchData(selectedPipeline); }}
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Monte Carlo Forecast</div>
          {pipelineBadge}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: colors.textMuted }}>
            {(iterationsRun || 10000).toLocaleString()} simulations · {dealsInSimulation} deals
            {generatedAt ? ` · updated ${formatTimeAgo(generatedAt)}` : ''}
          </span>
          <button
            onClick={handleRunForecast}
            disabled={triggeringRun}
            title="Re-run forecast"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'transparent',
              border: `1px solid ${colors.border}`,
              color: colors.textMuted,
              cursor: triggeringRun ? 'not-allowed' : 'pointer',
              padding: 0,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = colors.surfaceRaised; e.currentTarget.style.color = colors.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.textMuted; }}
          >
            {triggeringRun ? <SpinnerIcon size={14} /> : <RefreshIcon size={14} />}
          </button>
        </div>
      </div>

      {pipelineContextBadge && <div style={{ marginBottom: 12 }}>{pipelineContextBadge}</div>}
      {!pipelineContextBadge && <div style={{ marginBottom: 12 }} />}

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

      {/* Query Section */}
      <div style={{ borderTop: `1px solid #1A1F2B`, marginTop: 16, paddingTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Ask a Question
          </div>
          <div style={{ fontSize: 10, color: '#3B82F6', fontFamily: fonts.sans }}>
            What-if scenarios supported ✦
          </div>
        </div>

        {/* Scrollable messages area */}
        <div style={{
          maxHeight: turns.length > 0 ? 380 : undefined,
          overflowY: turns.length > 0 ? 'auto' : undefined,
          marginBottom: 10,
          paddingRight: turns.length > 0 ? 2 : 0,
        } as React.CSSProperties}>

          {/* Suggested chips — shown until first question submitted */}
          {turns.length === 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {SUGGESTED_QUESTIONS.map((sq) => (
                  <button
                    key={sq.label}
                    onClick={() => submitQuestion(sq.label)}
                    style={{
                      fontSize: 11, padding: '4px 12px', borderRadius: 20,
                      background: sq.category === 'what-if' ? '#1A2030' : '#1A1F2A',
                      color: sq.category === 'what-if' ? '#60A5FA' : '#5A6578',
                      border: sq.category === 'what-if' ? '1px solid #1E3A5F' : '1px solid #2A3040',
                      cursor: 'pointer', fontFamily: fonts.sans, transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = '#3B82F6')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = sq.category === 'what-if' ? '#1E3A5F' : '#2A3040')}
                  >
                    {sq.category === 'what-if' && <span style={{ marginRight: 4, opacity: 0.7 }}>↻</span>}
                    {sq.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: colors.textDim, marginTop: 8 }}>
                Blue chips are what-if scenarios — try "What if we lose our top rep?" or any scenario question
              </div>
            </div>
          )}

          {/* Conversation thread */}
          {turns.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {turns.reduce<{ q: string; a: string }[]>((pairs, turn, i) => {
                if (turn.role === 'user') pairs.push({ q: turn.content, a: turns[i + 1]?.content ?? '' });
                return pairs;
              }, []).map((pair, i, arr) => (
                <div key={i}>
                  {/* Question row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, color: '#3B82F6',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      flexShrink: 0, marginTop: 2, minWidth: 14,
                    }}>Q</span>
                    <span style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 1.5 }}>{pair.q}</span>
                  </div>
                  {/* Answer row */}
                  {pair.a && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginTop: 5,
                        background: '#3B82F6',
                      }} />
                      <p style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.6, margin: 0 }}>{pair.a}</p>
                    </div>
                  )}
                  {/* Follow-up chips only after the last answer */}
                  {i === arr.length - 1 && queryAnswer?.followUps?.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                      {queryAnswer.followUps.map((fq, fi) => (
                        <button
                          key={fi}
                          onClick={() => submitQuestion(fq)}
                          style={{
                            fontSize: 11, padding: '4px 12px', borderRadius: 20,
                            background: '#1A1F2A', color: '#5A6578',
                            border: '1px solid #2A3040', cursor: 'pointer',
                            fontFamily: fonts.sans, transition: 'border-color 0.15s',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.borderColor = '#3B82F6')}
                          onMouseLeave={e => (e.currentTarget.style.borderColor = '#2A3040')}
                        >
                          {fq}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input row */}
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center',
          borderTop: turns.length > 0 ? `1px solid #1A1F2B` : undefined,
          paddingTop: turns.length > 0 ? 10 : 0,
        }}>
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitQuestion(question); }}
            placeholder={turns.length > 0 ? 'Ask a follow-up or what-if question...' : 'Ask a question or try a what-if scenario...'}
            disabled={queryLoading}
            style={{
              flex: 1, height: 36, padding: '0 12px', fontSize: 12,
              background: colors.surfaceRaised,
              border: `1px solid ${queryError ? colors.red : colors.border}`,
              borderRadius: 6, color: colors.text, fontFamily: fonts.sans,
              outline: 'none',
            }}
          />
          <button
            onClick={() => submitQuestion(question)}
            disabled={queryLoading || !question.trim()}
            style={{
              width: 32, height: 32, borderRadius: 6, flexShrink: 0,
              background: queryLoading || !question.trim() ? colors.surfaceRaised : colors.accent,
              border: 'none', cursor: queryLoading || !question.trim() ? 'default' : 'pointer',
              color: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s',
            }}
          >
            {queryLoading ? <SpinnerIcon size={14} /> : '→'}
          </button>
        </div>

        {queryError && (
          <div style={{ fontSize: 11, color: colors.red, marginTop: 6 }}>{queryError}</div>
        )}

        {/* Past runs + recent questions footer */}
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Run history */}
          {runHistory.length > 1 && (
            <div>
              <button
                onClick={() => setRunsOpen(o => !o)}
                style={{
                  fontSize: 10, color: colors.textMuted, background: 'none',
                  border: 'none', cursor: 'pointer', padding: 0, fontFamily: fonts.sans,
                }}
              >
                {runsOpen ? '▾' : '▸'} Past runs ({runHistory.length})
              </button>
              {runsOpen && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {runHistory.map((run, i) => {
                    const isActive = run.runId === activeRunId;
                    return (
                      <button
                        key={run.runId}
                        onClick={() => {
                          setTurns([]);
                          setQueryAnswer(null);
                          sessionIdRef.current = crypto.randomUUID();
                          fetchData(null, run.runId);
                        }}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '5px 8px', borderRadius: 6, width: '100%',
                          background: isActive ? '#1A2030' : 'transparent',
                          border: isActive ? '1px solid #1E3A5F' : '1px solid transparent',
                          cursor: 'pointer', textAlign: 'left',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = colors.surfaceRaised; }}
                        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <div>
                          <span style={{ fontSize: 11, color: isActive ? '#60A5FA' : colors.textSecondary, fontWeight: isActive ? 600 : 400 }}>
                            {run.pipelineFilter ?? 'All pipelines'}
                          </span>
                          {run.pipelineType && (
                            <span style={{ fontSize: 10, color: colors.textDim, marginLeft: 6 }}>
                              · {INFERRED_TYPE_LABELS[run.pipelineType] ?? run.pipelineType}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                          {run.p50 != null && (
                            <span style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.textMuted }}>
                              P50 {fmtCompact(run.p50)}
                            </span>
                          )}
                          <span style={{ fontSize: 10, color: colors.textDim }}>
                            {formatTimeAgo(run.createdAt)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Recent questions */}
          {history.length > 0 && (
            <div>
              <button
                onClick={() => setHistoryOpen(o => !o)}
                style={{
                  fontSize: 10, color: colors.textMuted, background: 'none',
                  border: 'none', cursor: 'pointer', padding: 0, fontFamily: fonts.sans,
                }}
              >
                {historyOpen ? '▾' : '▸'} Recent questions
              </button>
              {historyOpen && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {history.map((item, i) => (
                    <div key={i}>
                      {i > 0 && <div style={{ height: 1, background: '#1A1F2B', margin: '8px 0' }} />}
                      <button
                        onClick={() => setQuestion(item.question)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          padding: 0, textAlign: 'left', width: '100%',
                        }}
                      >
                        <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans }}>{item.question}</div>
                        <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2, fontFamily: fonts.sans }}>
                          {item.answer.length > 80 ? item.answer.slice(0, 80) + '…' : item.answer}
                        </div>
                        <div style={{ fontSize: 10, color: colors.textDim, marginTop: 2, fontFamily: fonts.sans }}>
                          {formatTimeAgo(item.createdAt)}
                        </div>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
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

interface TornadoTooltipProps {
  driver: VarianceDriver;
  pos: { x: number; y: number; rowHeight: number };
}

function TornadoTooltip({ driver, pos }: TornadoTooltipProps) {
  const TOOLTIP_WIDTH = 320;
  const TOOLTIP_APPROX_HEIGHT = 200;
  const MARGIN = 8;

  const windowW = window.innerWidth;
  let left = pos.x + (pos.rowHeight / 2) - (TOOLTIP_WIDTH / 2);
  left = Math.max(MARGIN, Math.min(left, windowW - TOOLTIP_WIDTH - MARGIN));

  // Place above the row if there's room, else below
  const spaceAbove = pos.y - MARGIN;
  const top = spaceAbove >= TOOLTIP_APPROX_HEIGHT
    ? pos.y - TOOLTIP_APPROX_HEIGHT - 6
    : pos.y + pos.rowHeight + 6;

  const { assumption } = driver;

  const skewColor = !assumption ? '#64748B'
    : assumption.skew === 'downside_heavy' ? '#EF4444'
    : assumption.skew === 'upside_heavy'   ? '#22C55E'
    : '#64748B';

  const skewLabel = !assumption ? ''
    : assumption.skew === 'downside_heavy' ? 'DOWNSIDE RISK'
    : assumption.skew === 'upside_heavy'   ? 'UPSIDE POTENTIAL'
    : 'BALANCED';

  // Parse numeric values for the range dot position
  // Values come as formatted strings like "$18,400", "19%", "45 days"
  function parseNumericValue(s: string): number {
    const stripped = s.replace(/[$,%]/g, '').replace(/[KkMmBb]$/, '').trim();
    return parseFloat(stripped) || 0;
  }

  if (!assumption) {
    // Minimal tooltip for runs before enrichment
    return (
      <div style={{
        position: 'fixed',
        top,
        left,
        width: TOOLTIP_WIDTH,
        background: '#1A1F2B',
        border: '1px solid #2A3142',
        borderRadius: 8,
        padding: '12px 14px',
        zIndex: 1000,
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        pointerEvents: 'none',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#E2E8F0', marginBottom: 6 }}>{driver.label}</div>
        <div style={{ fontSize: 11, color: '#94A3B8' }}>
          Impact: <span style={{ color: '#EF4444' }}>-{fmtCompact(Math.abs(driver.downsideImpact))}</span> pessimistic
          {' / '}
          <span style={{ color: '#22C55E' }}>+{fmtCompact(driver.upsideImpact)}</span> optimistic
        </div>
      </div>
    );
  }

  const lowNum   = parseNumericValue(assumption.low);
  const highNum  = parseNumericValue(assumption.high);
  const currNum  = parseNumericValue(assumption.value);
  const dotPct   = highNum > lowNum
    ? Math.max(0, Math.min(100, ((currNum - lowNum) / (highNum - lowNum)) * 100))
    : 50;

  return (
    <div style={{
      position: 'fixed',
      top,
      left,
      width: TOOLTIP_WIDTH,
      background: '#1A1F2B',
      border: '1px solid #2A3142',
      borderRadius: 8,
      overflow: 'hidden',
      zIndex: 1000,
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
      pointerEvents: 'none',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 14px 8px',
        borderBottom: `2px solid ${skewColor}30`,
        background: `${skewColor}10`,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#E2E8F0' }}>{driver.label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: skewColor, letterSpacing: '0.06em' }}>{skewLabel}</span>
      </div>

      <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Current assumption */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
            Current assumption
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.4 }}>{assumption.label}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#E2E8F0', marginTop: 2 }}>{assumption.value}</div>
        </div>

        {/* Modeled range */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Modeled range
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: '#EF4444', minWidth: 32, textAlign: 'right', flexShrink: 0 }}>{assumption.low}</span>
            <div style={{ flex: 1, position: 'relative', height: 8 }}>
              {/* Track */}
              <div style={{ position: 'absolute', inset: 0, borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${dotPct}%`, background: '#EF444440', borderRadius: '4px 0 0 4px' }} />
                <div style={{ flex: 1, background: '#22C55E40', borderRadius: '0 4px 4px 0' }} />
              </div>
              {/* Dot */}
              <div style={{
                position: 'absolute',
                top: '50%',
                left: `${dotPct}%`,
                transform: 'translate(-50%, -50%)',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#E2E8F0',
                border: '2px solid #1A1F2B',
                boxShadow: '0 0 0 1px #64748B',
              }} />
            </div>
            <span style={{ fontSize: 10, color: '#22C55E', minWidth: 32, flexShrink: 0 }}>{assumption.high}</span>
          </div>
        </div>

        {/* Forecast impact */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Forecast impact
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: '#EF4444' }}>
              ▼ {fmtCompact(Math.abs(driver.downsideImpact))} if {driver.label.toLowerCase()} falls
            </span>
            <span style={{ fontSize: 11, color: '#22C55E' }}>
              ▲ +{fmtCompact(driver.upsideImpact)} if it rises
            </span>
          </div>
        </div>

        {/* Implication */}
        <div style={{
          fontSize: 11,
          color: '#94A3B8',
          lineHeight: 1.5,
          borderTop: '1px solid #2A3142',
          paddingTop: 8,
        }}>
          {assumption.implication}
        </div>
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
  const [hoveredDriver, setHoveredDriver] = useState<{ driver: VarianceDriver; pos: { x: number; y: number; rowHeight: number } } | null>(null);

  return (
    <div style={{ flex: '0 0 24%', display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
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
            <div
              key={i}
              style={{ display: 'flex', flexDirection: 'column', gap: 2, cursor: 'default' }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoveredDriver({ driver: d, pos: { x: rect.left, y: rect.top, rowHeight: rect.height } });
              }}
              onMouseLeave={() => setHoveredDriver(null)}
            >
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

      {hoveredDriver && (
        <TornadoTooltip driver={hoveredDriver.driver} pos={hoveredDriver.pos} />
      )}
    </div>
  );
}
