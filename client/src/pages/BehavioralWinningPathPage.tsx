import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useWorkspace } from '../context/WorkspaceContext';
import { colors, fonts } from '../styles/theme';

const font = fonts.sans;
const mono = fonts.mono;

// ============================================================================
// Types
// ============================================================================

interface BehavioralMilestone {
  id: string;
  timeWindow: string;
  windowStart: number;
  windowEnd: number;
  title: string;
  subtitle: string;
  source: string;
  tier: 1 | 2 | 3 | 4;
  signals: string[];
  wonPct: number;
  lostPct: number;
  lift: number;
  avgDaysToMilestone: number;
  insufficientData?: boolean;
  isDiscovered?: boolean;
  description?: string;
  evidence?: string[];
}

interface LostAbsence {
  milestoneId: string;
  title: string;
  source: string;
  lostDealPct: number;
  liftIfPresent: number;
}

interface MilestoneMatrix {
  tier: 1 | 2 | 3 | 4;
  tierLabel: string;
  confidenceNote: string;
  analysisPeriodDays: number;
  totalWonDeals: number;
  totalLostDeals: number;
  avgWonCycleDays: number;
  avgLostCycleDays: number;
  wonMilestones: BehavioralMilestone[];
  lostAbsences: LostAbsence[];
  isDiscovered?: boolean;
  discoveryNote?: string;
  wonMedianDays?: number;
  meta?: {
    totalWonDeals: number;
    totalLostDeals: number;
    transcriptsSampled: number;
    dealsScored: number;
    analysisPeriodDays: number;
  };
}

interface TierProbe {
  tier: 1 | 2 | 3 | 4;
  tierLabel: string;
  availability: {
    conversations: { exists: boolean; count: number; withTranscripts: number; linkedToDealsPct: number };
    emailActivities: { exists: boolean; count: number; distinctDeals: number };
    contactRoles: { exists: boolean; dealsWithMultipleContacts: number; dealsWithRoles: number };
    stageHistory: { exists: boolean; count: number; distinctDeals: number };
  };
}

interface RunResult {
  runId: string;
  completedAt: string;
  result?: { milestone_matrix?: MilestoneMatrix; narrative?: string };
  outputText?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function getColIndex(windowStart: number): number {
  if (windowStart >= 75) return 3;
  if (windowStart >= 45) return 2;
  if (windowStart >= 15) return 1;
  return 0;
}

const COL_HEADERS = [
  { label: 'Day 0–30',   sub: 'Opening motion' },
  { label: 'Day 31–60',  sub: 'Champion & use case' },
  { label: 'Day 61–90',  sub: 'Technical validation' },
  { label: 'Day 91–120+', sub: 'Executive & close' },
];

function deriveColHeaders(milestones: BehavioralMilestone[]): { label: string; sub: string }[] {
  const seen = new Set<string>();
  const cols: { label: string; sub: string }[] = [];
  for (const m of [...milestones].sort((a, b) => a.windowStart - b.windowStart)) {
    if (!seen.has(m.timeWindow)) {
      seen.add(m.timeWindow);
      cols.push({ label: m.timeWindow, sub: '' });
    }
    if (cols.length === 4) break;
  }
  while (cols.length < 4) cols.push(COL_HEADERS[cols.length]);
  return cols;
}

type SourceKey = 'CI' | 'Email' | 'CRM Roles' | 'Stage History' | string;

const SOURCE_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  CI:            { color: '#22d3ee', bg: 'rgba(34,211,238,0.10)',  border: 'rgba(34,211,238,0.22)' },
  Email:         { color: '#a78bfa', bg: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.22)' },
  'CRM Roles':   { color: '#a78bfa', bg: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.22)' },
  'Stage History':{ color: '#fbbf24', bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.22)' },
};

function sourceMeta(source: SourceKey) {
  return SOURCE_STYLE[source] ?? SOURCE_STYLE['Stage History'];
}

function formatTimeAgo(iso: string): string {
  try {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    const hrs = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
    if (hrs < 1) return 'just now';
    if (hrs < 24) return `${hrs}h ago`;
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  } catch { return '—'; }
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

// ============================================================================
// Sub-components
// ============================================================================

function SkeletonBlock({ w = '100%', h = 14, radius = 4 }: { w?: string | number; h?: number; radius?: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: radius,
      background: `linear-gradient(90deg, ${colors.surfaceRaised} 25%, ${colors.surfaceHover} 50%, ${colors.surfaceRaised} 75%)`,
      backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite',
    }} />
  );
}

function TierBadge({ tier, label }: { tier: number; label: string }) {
  const { color, bg, border } = tier === 1
    ? { color: '#22d3ee', bg: 'rgba(34,211,238,0.10)', border: 'rgba(34,211,238,0.25)' }
    : tier === 2
    ? { color: '#a78bfa', bg: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.25)' }
    : tier === 3
    ? { color: colors.orange, bg: colors.orangeSoft, border: 'rgba(249,115,22,0.25)' }
    : { color: colors.yellow, bg: colors.yellowSoft, border: 'rgba(251,191,36,0.25)' };
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
      color, background: bg, border: `1px solid ${border}`,
      borderRadius: 4, padding: '2px 8px', fontFamily: font, whiteSpace: 'nowrap',
    }}>
      Tier {tier} · {label}
    </span>
  );
}

function SourceBadge({ source, small }: { source: string; small?: boolean }) {
  const { color, bg, border } = sourceMeta(source);
  return (
    <span style={{
      fontSize: small ? 10 : 11, fontWeight: 600, letterSpacing: '0.03em',
      color, background: bg, border: `1px solid ${border}`,
      borderRadius: 4, padding: small ? '1px 6px' : '2px 7px', fontFamily: font, whiteSpace: 'nowrap',
    }}>
      {source}
    </span>
  );
}

function WonCard({ milestone, selected, onClick, deltaWonPct }: {
  milestone: BehavioralMilestone;
  selected: boolean;
  onClick: () => void;
  deltaWonPct?: number;
}) {
  const insuf = !!milestone.insufficientData;
  return (
    <div
      onClick={onClick}
      style={{
        background: selected ? 'rgba(15,217,162,0.06)' : colors.surface,
        border: `1px solid ${selected ? '#0fd9a2' : insuf ? colors.border : 'rgba(34,197,94,0.20)'}`,
        borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
        opacity: insuf ? 0.6 : 1,
        boxShadow: selected ? '0 0 0 1px rgba(15,217,162,0.3)' : undefined,
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = insuf ? colors.borderLight : 'rgba(34,197,94,0.40)'; }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = insuf ? colors.border : 'rgba(34,197,94,0.20)'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
        <SourceBadge source={milestone.source} small />
        <span style={{ fontSize: 10, color: colors.textMuted, fontFamily: mono, whiteSpace: 'nowrap' }}>
          {milestone.timeWindow}
        </span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: font, lineHeight: 1.3, marginBottom: 3 }}>
        {milestone.title}
      </div>
      <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: font, lineHeight: 1.4, marginBottom: 8 }}>
        {milestone.subtitle}
      </div>
      {insuf ? (
        <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: font, fontStyle: 'italic' }}>
          Insufficient data
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', fontFamily: mono }}>
            {milestone.wonPct}%
          </span>
          <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: font }}>of won deals</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: '#fbbf24', fontFamily: mono }}>
            {milestone.lift}×
          </span>
          <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: font }}>lift</span>
          {deltaWonPct !== undefined && (
            <span style={{
              fontSize: 11, fontWeight: 700, fontFamily: mono,
              color: deltaWonPct >= 0 ? '#4ade80' : '#f87171',
              marginLeft: 2,
            }}>
              {deltaWonPct >= 0 ? `+${deltaWonPct}pp ↑` : `${deltaWonPct}pp ↓`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function LostCard({ absence, deltaLostPct }: { absence: LostAbsence; deltaLostPct?: number }) {
  return (
    <div style={{
      background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.20)',
      borderRadius: 8, padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <SourceBadge source={absence.source} small />
        <span style={{ fontSize: 10, color: colors.textMuted, fontFamily: mono }}>↓ absent</span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#e8a0a7', fontFamily: font, lineHeight: 1.3, marginBottom: 6 }}>
        {absence.title}
      </div>
      <div style={{ fontSize: 11, fontFamily: font }}>
        <span style={{ color: '#f87171', fontWeight: 700, fontFamily: mono }}>{absence.lostDealPct}%</span>
        <span style={{ color: colors.textMuted }}> of lost deals missing · </span>
        <span style={{ color: '#fbbf24', fontWeight: 700, fontFamily: mono }}>{absence.liftIfPresent}×</span>
        <span style={{ color: colors.textMuted }}> more likely to lose</span>
        {deltaLostPct !== undefined && (
          <span style={{
            fontSize: 11, fontWeight: 700, fontFamily: mono,
            color: deltaLostPct >= 0 ? '#f87171' : '#4ade80',
            marginLeft: 4,
          }}>
            {deltaLostPct >= 0 ? `+${deltaLostPct}pp ↑ absent` : `${deltaLostPct}pp ↓ absent`}
          </span>
        )}
      </div>
    </div>
  );
}

function DetailPanel({ milestone, onClose }: { milestone: BehavioralMilestone; onClose: () => void }) {
  const { color, bg, border } = sourceMeta(milestone.source);
  return (
    <div style={{
      background: 'rgba(15,217,162,0.04)', border: '1px solid rgba(15,217,162,0.25)',
      borderRadius: 10, padding: '20px 24px', marginTop: 16,
      boxShadow: '0 0 20px rgba(15,217,162,0.08)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: mono, marginBottom: 4 }}>
            Signal breakdown · {milestone.timeWindow}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: colors.text, fontFamily: font, marginBottom: 3 }}>
            {milestone.title}
          </div>
          <div style={{ fontSize: 13, color: colors.textMuted, fontFamily: font }}>{milestone.subtitle}</div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: `1px solid ${colors.border}`,
            color: colors.textMuted, borderRadius: 6, width: 28, height: 28,
            cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: font, flexShrink: 0, marginLeft: 16,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 0, borderRadius: 8, overflow: 'hidden', border: `1px solid ${colors.border}` }}>
        <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, color: colors.textMuted, background: colors.surfaceRaised, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Underlying signals
        </div>
        <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, color: colors.textMuted, background: colors.surfaceRaised, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'right', whiteSpace: 'nowrap' }}>
          % of won deals
        </div>
        <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, color: colors.textMuted, background: colors.surfaceRaised, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'right', whiteSpace: 'nowrap' }}>
          Win rate lift
        </div>
        <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, color: colors.textMuted, background: colors.surfaceRaised, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'center' }}>
          Source
        </div>

        {(milestone.signals.length > 0 ? milestone.signals : [`${milestone.title} signal`]).map((sig, i) => (
          <>
            <div key={`sig-${i}`} style={{ padding: '10px 14px', fontSize: 13, color: colors.textSecondary, fontFamily: font, borderTop: `1px solid ${colors.border}` }}>
              → {sig}
            </div>
            <div key={`pct-${i}`} style={{ padding: '10px 14px', textAlign: 'right', borderTop: `1px solid ${colors.border}` }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#4ade80', fontFamily: mono }}>{milestone.wonPct}%</span>
            </div>
            <div key={`lift-${i}`} style={{ padding: '10px 14px', textAlign: 'right', borderTop: `1px solid ${colors.border}` }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', fontFamily: mono }}>{milestone.lift}×</span>
            </div>
            <div key={`src-${i}`} style={{ padding: '10px 14px', textAlign: 'center', borderTop: `1px solid ${colors.border}` }}>
              <SourceBadge source={milestone.source} small />
            </div>
          </>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
        <div style={{ flex: 1, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.20)', borderRadius: 8, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#4ade80', fontFamily: mono }}>{milestone.wonPct}%</div>
          <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: font, marginTop: 2 }}>of won deals</div>
        </div>
        <div style={{ flex: 1, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.20)', borderRadius: 8, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fbbf24', fontFamily: mono }}>{milestone.lift}×</div>
          <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: font, marginTop: 2 }}>lift vs absent</div>
        </div>
        <div style={{ flex: 1, background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: mono, lineHeight: 1.4 }}>{milestone.source}</div>
          <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: font, marginTop: 2 }}>data source</div>
        </div>
      </div>

      {milestone.evidence && milestone.evidence.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: colors.textMuted,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            fontFamily: font, marginBottom: 8,
          }}>
            From your transcripts
          </div>
          {milestone.evidence.map((phrase, i) => (
            <div key={i} style={{
              borderLeft: '2px solid rgba(15,217,162,0.3)',
              paddingLeft: 10, marginBottom: 8,
              fontSize: 12, color: colors.textSecondary, fontFamily: font,
              fontStyle: 'italic', lineHeight: 1.5,
            }}>
              "{phrase}"
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function renderInline(raw: string): ReactNode {
  const cleaned = raw
    .replace(/\*\*(.+?)\*\*/g, '\x02BOLD\x03$1\x02/BOLD\x03')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '\x02EM\x03$1\x02/EM\x03');
  const parts = cleaned.split(/(\x02BOLD\x03[\s\S]*?\x02\/BOLD\x03|\x02EM\x03[\s\S]*?\x02\/EM\x03)/);
  return parts.map((p, i) => {
    if (p.startsWith('\x02BOLD\x03')) return <strong key={i}>{p.replace(/\x02BOLD\x03|\x02\/BOLD\x03/g, '')}</strong>;
    if (p.startsWith('\x02EM\x03')) return <em key={i}>{p.replace(/\x02EM\x03|\x02\/EM\x03/g, '')}</em>;
    return p;
  });
}

function SynthesisCard({ text, completedAt, periodDays }: { text: string; completedAt: string; periodDays: number }) {
  const stripped = text.replace(/<actions>[\s\S]*?<\/actions>/gi, '').replace(/^\s*<\/?[a-z][a-z0-9]*>\s*$/gim, '');
  const lines = stripped.split('\n').filter(l => l.trim());
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '20px 24px', marginTop: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.textSecondary, fontFamily: font }}>AI Analysis</div>
        <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: font }}>
          {formatDate(completedAt)} · {periodDays}-day window
        </div>
      </div>
      <div style={{ fontSize: 13, color: colors.textSecondary, fontFamily: font, lineHeight: 1.7 }}>
        {lines.map((line, i) => {
          const trimmed = line.trim();
          const isHeader = /^#{1,3}\s/.test(trimmed) || /^\*\*[^*]+\*\*[:.]?\s*$/.test(trimmed);
          const isBullet = /^[-•]\s/.test(trimmed) || /^[*]\s/.test(trimmed);
          const withoutPrefix = trimmed.replace(/^#{1,3}\s/, '').replace(/^[-•*]\s*/, '');
          if (isHeader) return (
            <div key={i} style={{ fontSize: 13, fontWeight: 700, color: colors.text, marginTop: i > 0 ? 14 : 0, marginBottom: 4, fontFamily: font }}>
              {renderInline(withoutPrefix)}
            </div>
          );
          if (isBullet) return (
            <div key={i} style={{ paddingLeft: 14, marginBottom: 3 }}>
              <span style={{ color: colors.accent, marginRight: 6 }}>→</span>{renderInline(withoutPrefix)}
            </div>
          );
          if (!trimmed) return <div key={i} style={{ height: 8 }} />;
          return <div key={i} style={{ marginBottom: 3 }}>{renderInline(trimmed)}</div>;
        })}
      </div>
    </div>
  );
}

function UpgradePrompt({ tier }: { tier: number }) {
  const navigate = useNavigate();
  const go = () => navigate('/connectors');

  if (tier === 1) return null;

  const content = tier === 2 ? {
    title: 'Connect conversation intelligence to unlock full behavioral analysis',
    body: 'Gong or Fireflies would replace email engagement proxies with transcript-based signals: champion multi-threading, use case articulation, technical win language, and executive activation.',
    buttons: [{ label: 'Connect Gong' }, { label: 'Connect Fireflies' }],
  } : tier === 3 ? {
    title: 'Connect email or conversation intelligence for behavioral signal analysis',
    body: 'Current analysis uses CRM contact associations as proxies. Email or call data would confirm whether those contacts were actually engaged.',
    buttons: [{ label: 'Connect Email' }, { label: 'Connect Gong' }],
  } : {
    title: 'Connect conversation intelligence, email, or enrich contact roles',
    body: 'Stage-based milestones reflect CRM record movement, not buyer behavior. Any engagement data layer would significantly improve signal quality.',
    buttons: [{ label: 'Go to Connectors' }],
  };

  return (
    <div style={{
      background: colors.surface, border: `1px solid rgba(251,191,36,0.25)`,
      borderRadius: 10, padding: '20px 24px', marginTop: 20,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, fontFamily: font, marginBottom: 6 }}>
        {content.title}
      </div>
      <div style={{ fontSize: 13, color: colors.textMuted, fontFamily: font, lineHeight: 1.6, marginBottom: 14 }}>
        {content.body}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {content.buttons.map(btn => (
          <button
            key={btn.label}
            onClick={go}
            style={{
              background: colors.surfaceRaised, border: `1px solid ${colors.borderLight}`,
              color: colors.textSecondary, fontSize: 13, fontWeight: 600,
              padding: '7px 14px', borderRadius: 7, cursor: 'pointer', fontFamily: font,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = colors.accent; (e.currentTarget as HTMLButtonElement).style.color = colors.accent; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = colors.borderLight; (e.currentTarget as HTMLButtonElement).style.color = colors.textSecondary; }}
          >
            {btn.label} →
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function BehavioralWinningPathPage() {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id;

  const [tierProbe, setTierProbe]           = useState<TierProbe | null>(null);
  const [matrix, setMatrix]                 = useState<MilestoneMatrix | null>(null);
  const [synthesis, setSynthesis]           = useState<string | null>(null);
  const [completedAt, setCompletedAt]       = useState<string | null>(null);
  const [loading, setLoading]               = useState(true);
  const [noRun, setNoRun]                   = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [running, setRunning]               = useState(false);
  const [runMessage, setRunMessage]         = useState<string | null>(null);
  const [showLost, setShowLost]             = useState(true);
  const [selectedMilestone, setSelected]   = useState<BehavioralMilestone | null>(null);
  const [pipelines, setPipelines]           = useState<{ id: string; name: string }[]>([]);
  const [activePipeline, setActivePipeline] = useState<string | null>(null);
  const [baselineMatrix, setBaselineMatrix] = useState<MilestoneMatrix | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCompletedAt = useRef<string | null>(null);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  // Fetch CRM pipeline list for the filter bar
  useEffect(() => {
    if (!workspaceId) return;
    api.get('/deals/crm-pipelines')
      .then((data: any) => setPipelines(Array.isArray(data) ? data : []))
      .catch(() => setPipelines([]));
  }, [workspaceId]);

  const applyRunResult = useCallback((run: RunResult) => {
    const m = run.result?.milestone_matrix ?? null;
    const s = run.result?.narrative ?? run.outputText ?? null;
    setMatrix(m);
    setSynthesis(s);
    setCompletedAt(run.completedAt ?? null);
    lastCompletedAt.current = run.completedAt ?? null;
  }, []);

  const loadData = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    setNoRun(false);

    // Two parallel requests
    const [tierRes, latestRes] = await Promise.allSettled([
      api.get('/skills/behavioral-winning-path/tier'),
      api.get('/skills/behavioral-winning-path/latest'),
    ]);

    if (tierRes.status === 'fulfilled') setTierProbe(tierRes.value as TierProbe);

    if (latestRes.status === 'fulfilled') {
      applyRunResult(latestRes.value as RunResult);
      setBaselineMatrix((latestRes.value as RunResult).result?.milestone_matrix ?? null);
    } else {
      const err = (latestRes.reason as any);
      if (err?.status === 404 || String(err?.message).includes('404') || String(err?.message).includes('No completed')) {
        setNoRun(true);
        setMatrix(null);
        setSynthesis(null);
      } else {
        setError(err?.message ?? 'Failed to load data');
      }
    }

    setLoading(false);
  }, [workspaceId, applyRunResult]);

  const loadPipelineMatrix = useCallback(async (pipeline: string) => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    setNoRun(false);
    setSynthesis(null);
    try {
      const data = await api.get(`/skills/behavioral-winning-path/matrix?pipeline=${encodeURIComponent(pipeline)}`);
      setMatrix(data as MilestoneMatrix);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load pipeline matrix');
      setMatrix(null);
    }
    setLoading(false);
  }, [workspaceId]);

  // Single effect: re-runs when workspaceId or activePipeline changes
  useEffect(() => {
    if (!workspaceId) return;
    if (activePipeline) loadPipelineMatrix(activePipeline);
    else loadData();
    return stopPoll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, activePipeline]);

  const startRun = async () => {
    if (running) return;
    setRunning(true);
    setRunMessage(null);
    setNoRun(false);
    try {
      await api.post('/skills/behavioral-winning-path/run', {});
      setRunMessage('Running analysis…');

      pollRef.current = setInterval(async () => {
        try {
          const res = await api.get('/skills/behavioral-winning-path/latest') as RunResult;
          if (res.completedAt && res.completedAt !== lastCompletedAt.current) {
            stopPoll();
            applyRunResult(res);
            setRunning(false);
            setRunMessage('Winning Path updated');
            setTimeout(() => setRunMessage(null), 4000);
          }
        } catch { /* still running */ }
      }, 5000);
    } catch (err: any) {
      setRunning(false);
      setRunMessage(err?.message ?? 'Run failed');
    }
  };

  // Dynamic column headers from discovered milestones (falls back to hardcoded for Tiers 2–4)
  const colHeaders = deriveColHeaders(matrix?.wonMilestones ?? []);
  const colLabelToIdx = new Map(colHeaders.map((c, i) => [c.label, i]));

  // Column grouping — prefer label-based bucketing for discovered milestones
  const wonByCol = (matrix?.wonMilestones ?? []).reduce<BehavioralMilestone[][]>((acc, m) => {
    const ci = colLabelToIdx.has(m.timeWindow)
      ? colLabelToIdx.get(m.timeWindow)!
      : getColIndex(m.windowStart);
    if (!acc[ci]) acc[ci] = [];
    acc[ci].push(m);
    return acc;
  }, [[], [], [], []]);

  const lostByCol = (matrix?.lostAbsences ?? []).reduce<LostAbsence[][]>((acc, a) => {
    const matchedMilestone = matrix?.wonMilestones.find(m => m.id === a.milestoneId);
    const ci = matchedMilestone ? getColIndex(matchedMilestone.windowStart) : 0;
    if (!acc[ci]) acc[ci] = [];
    acc[ci].push(a);
    return acc;
  }, [[], [], [], []]);

  // Delta lookups — only populated when a pipeline filter is active and baseline exists
  const baselineWonPctById: Record<string, number> | null =
    activePipeline && baselineMatrix
      ? Object.fromEntries(baselineMatrix.wonMilestones.map(m => [m.id, m.wonPct]))
      : null;

  const baselineLostPctById: Record<string, number> | null =
    activePipeline && baselineMatrix
      ? Object.fromEntries(baselineMatrix.lostAbsences.map(a => [a.milestoneId, a.lostDealPct]))
      : null;

  return (
    <div className="wp-page" style={{ background: colors.bg, minHeight: '100vh', fontFamily: font, color: colors.text, maxWidth: 1280, margin: '0 auto' }}>
      <style>{`
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .wp-page { padding: 28px 32px; }
        @media (max-width: 640px) { .wp-page { padding: 16px 14px; } }
        .wp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; gap: 16px; flex-wrap: wrap; }
        .wp-controls { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex-shrink: 0; }
        @media (max-width: 640px) { .wp-controls { align-items: flex-start; width: 100%; } }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="wp-header">
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5, flexWrap: 'wrap' }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(15,217,162,0.12)', border: '1px solid rgba(15,217,162,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 14 }}>◈</span>
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: colors.text, fontFamily: font }}>
              Winning Path
            </h1>
            {matrix?.isDiscovered ? (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)',
                color: '#4ade80', fontFamily: font, whiteSpace: 'nowrap',
              }}>
                Discovered · {matrix.meta?.transcriptsSampled ?? '?'} transcripts
              </span>
            ) : (
              tierProbe && <TierBadge tier={tierProbe.tier} label={tierProbe.tierLabel} />
            )}
          </div>
          <div style={{ fontSize: 13, color: colors.textMuted, fontFamily: font, marginBottom: 4, lineHeight: 1.5 }}>
            Behavioral milestones that characterize won deals
            {tierProbe && <> — sourced from <span style={{ color: colors.textSecondary }}>{tierProbe.tierLabel}</span></>}
          </div>
          {matrix && (
            <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: font, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span><span style={{ color: '#4ade80', fontWeight: 600 }}>{matrix.totalWonDeals}</span> won</span>
              <span>·</span>
              <span><span style={{ color: '#f87171', fontWeight: 600 }}>{matrix.totalLostDeals}</span> lost</span>
              <span>·</span>
              <span>{matrix.analysisPeriodDays}-day window</span>
              {completedAt && <><span>·</span><span>Updated {formatTimeAgo(completedAt)}</span></>}
            </div>
          )}
        </div>

        {/* Right controls */}
        <div className="wp-controls">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {matrix && (
              <button
                onClick={() => setShowLost(v => !v)}
                style={{
                  background: showLost ? colors.accentSoft : colors.surfaceRaised,
                  border: `1px solid ${showLost ? colors.accent : colors.borderLight}`,
                  color: showLost ? colors.accent : colors.textMuted,
                  fontSize: 12, fontWeight: 600, padding: '6px 12px',
                  borderRadius: 7, cursor: 'pointer', fontFamily: font, transition: 'all 0.15s',
                }}
              >
                Lost patterns
              </button>
            )}
            <button
              onClick={startRun}
              disabled={running}
              style={{
                background: running ? colors.surfaceRaised : colors.accentSoft,
                border: `1px solid ${running ? colors.borderLight : colors.accent}`,
                color: running ? colors.textMuted : colors.accent,
                fontSize: 13, fontWeight: 600, padding: '7px 14px',
                borderRadius: 7, cursor: running ? 'not-allowed' : 'pointer',
                fontFamily: font, display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
              }}
            >
              {running && (
                <span style={{ width: 10, height: 10, borderRadius: '50%', border: `2px solid ${colors.accent}`, borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
              )}
              {running ? 'Running…' : '▶ Run Now'}
            </button>
            <div style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderLight}`, borderRadius: 7, padding: '6px 12px', fontSize: 11, color: colors.textMuted, fontFamily: font }}>
              Runs Mondays 6 AM UTC
            </div>
          </div>
          {runMessage && (
            <div style={{ fontSize: 12, color: runMessage.includes('fail') || runMessage.includes('Fail') ? colors.red : colors.green, fontFamily: font }}>
              {runMessage}
            </div>
          )}
        </div>
      </div>

      {/* ── Pipeline filter pills ───────────────────────────────────────────── */}
      {pipelines.length > 1 && (
        <div style={{
          display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18,
          background: colors.surface, border: `1px solid ${colors.border}`,
          borderRadius: 9, padding: '10px 14px',
        }}>
          <button
            onClick={() => setActivePipeline(null)}
            style={{
              background: activePipeline === null ? colors.accentSoft : 'transparent',
              border: `1px solid ${activePipeline === null ? colors.accent : colors.borderLight}`,
              color: activePipeline === null ? colors.accent : colors.textMuted,
              fontSize: 12, fontWeight: 600, padding: '5px 12px',
              borderRadius: 6, cursor: 'pointer', fontFamily: font, transition: 'all 0.15s',
            }}
          >
            All Pipelines
          </button>
          {pipelines.map(p => (
            <button
              key={p.id}
              onClick={() => setActivePipeline(p.name)}
              style={{
                background: activePipeline === p.name ? colors.accentSoft : 'transparent',
                border: `1px solid ${activePipeline === p.name ? colors.accent : colors.borderLight}`,
                color: activePipeline === p.name ? colors.accent : colors.textMuted,
                fontSize: 12, fontWeight: 600, padding: '5px 12px',
                borderRadius: 6, cursor: 'pointer', fontFamily: font, transition: 'all 0.15s',
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ background: colors.redSoft, border: `1px solid rgba(239,68,68,0.25)`, borderRadius: 8, padding: '12px 18px', marginBottom: 20, fontSize: 13, color: colors.red, fontFamily: font }}>
          {error}
        </div>
      )}

      {/* ── Confidence banner (Tier 2–4) ────────────────────────────────────── */}
      {matrix && matrix.tier > 1 && (
        <div style={{
          background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.22)',
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          display: 'flex', gap: 8, alignItems: 'flex-start',
        }}>
          <span style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }}>⚠</span>
          <span style={{ fontSize: 13, color: '#fbbf24', fontFamily: font }}>{matrix.confidenceNote}</span>
        </div>
      )}

      {/* ── Loading skeleton ────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 20 }}>
          {/* Column headers skeleton */}
          <div style={{ display: 'grid', gridTemplateColumns: '110px repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            <div />
            {[0, 1, 2, 3].map(i => (
              <div key={i}>
                <SkeletonBlock h={14} w="70%" /><div style={{ marginTop: 6 }}><SkeletonBlock h={10} w="50%" /></div>
              </div>
            ))}
          </div>
          {/* Won row */}
          <div style={{ display: 'grid', gridTemplateColumns: '110px repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
            <SkeletonBlock h={60} radius={6} />
            {[0, 1, 2, 3].map(i => <SkeletonBlock key={i} h={80} radius={6} />)}
          </div>
          {/* Lost row */}
          <div style={{ display: 'grid', gridTemplateColumns: '110px repeat(4, 1fr)', gap: 12 }}>
            <SkeletonBlock h={60} radius={6} />
            {[0, 1, 2, 3].map(i => <SkeletonBlock key={i} h={60} radius={6} />)}
          </div>
        </div>
      )}

      {/* ── Empty state (no run yet) ─────────────────────────────────────────── */}
      {!loading && noRun && (
        <div style={{
          background: colors.surface, border: `1px solid ${colors.border}`,
          borderRadius: 10, padding: '64px 32px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>◈</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: colors.textSecondary, marginBottom: 8, fontFamily: font }}>
            No analysis yet
          </div>
          <div style={{ fontSize: 13, color: colors.textMuted, maxWidth: 420, margin: '0 auto 24px', lineHeight: 1.6, fontFamily: font }}>
            Run Behavioral Winning Path to identify the behavioral sequences that characterize your won deals.
          </div>
          <button
            onClick={startRun}
            disabled={running}
            style={{
              background: colors.accentSoft, border: `1px solid ${colors.accent}`,
              color: colors.accent, fontSize: 14, fontWeight: 600,
              padding: '10px 24px', borderRadius: 8, cursor: running ? 'not-allowed' : 'pointer',
              fontFamily: font, display: 'inline-flex', alignItems: 'center', gap: 8,
            }}
          >
            {running && <span style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${colors.accent}`, borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />}
            {running ? 'Running…' : '▶ Run Now'}
          </button>
        </div>
      )}

      {/* ── Main grid ───────────────────────────────────────────────────────── */}
      {!loading && matrix && (
        <>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' as any }}>
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden', minWidth: 520 }}>
            {/* Column header row */}
            <div style={{ display: 'grid', gridTemplateColumns: '110px repeat(4, 1fr)', gap: 0, borderBottom: `1px solid ${colors.border}` }}>
              <div style={{ padding: '12px 14px', fontSize: 11, fontWeight: 600, color: colors.textMuted, fontFamily: font, letterSpacing: '0.06em', textTransform: 'uppercase', borderRight: `1px solid ${colors.border}` }}>
                Stage
              </div>
              {colHeaders.map((col, ci) => (
                <div key={ci} style={{ padding: '12px 14px', borderRight: ci < 3 ? `1px solid ${colors.border}` : undefined }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: colors.text, fontFamily: font, marginBottom: 2 }}>{col.label}</div>
                  {col.sub && <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: font }}>{col.sub}</div>}
                </div>
              ))}
            </div>

            {/* Won row */}
            <div style={{ display: 'grid', gridTemplateColumns: '110px repeat(4, 1fr)', gap: 0 }}>
              <div style={{
                padding: '16px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                borderRight: `1px solid ${colors.border}`, borderBottom: showLost ? `1px solid ${colors.border}` : undefined,
              }}>
                <div style={{ width: 4, height: 36, background: 'rgba(74,222,128,0.5)', borderRadius: 2, marginBottom: 6 }} />
                <div style={{ fontSize: 11, fontWeight: 600, color: '#4ade80', fontFamily: font, textAlign: 'center', lineHeight: 1.4 }}>
                  Won<br />
                  <span style={{ fontFamily: mono }}>n={matrix.totalWonDeals}</span>
                </div>
              </div>
              {[0, 1, 2, 3].map(ci => (
                <div key={ci} style={{
                  padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 8,
                  borderRight: ci < 3 ? `1px solid ${colors.border}` : undefined,
                  borderBottom: showLost ? `1px solid ${colors.border}` : undefined,
                  minHeight: 80,
                }}>
                  {(wonByCol[ci] ?? []).map(m => (
                    <WonCard
                      key={m.id}
                      milestone={m}
                      selected={selectedMilestone?.id === m.id}
                      onClick={() => setSelected(prev => prev?.id === m.id ? null : m)}
                      deltaWonPct={
                        baselineWonPctById != null && !m.insufficientData
                          ? m.wonPct - (baselineWonPctById[m.id] ?? m.wonPct)
                          : undefined
                      }
                    />
                  ))}
                  {(wonByCol[ci] ?? []).length === 0 && (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 11, color: colors.textDim, fontFamily: font }}>—</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Lost row (toggleable) */}
            {showLost && (
              <div style={{ display: 'grid', gridTemplateColumns: '110px repeat(4, 1fr)', gap: 0 }}>
                <div style={{
                  padding: '16px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  borderRight: `1px solid ${colors.border}`,
                }}>
                  <div style={{ width: 4, height: 36, background: 'rgba(248,113,113,0.5)', borderRadius: 2, marginBottom: 6 }} />
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#f87171', fontFamily: font, textAlign: 'center', lineHeight: 1.4 }}>
                    Lost<br />
                    <span style={{ fontFamily: mono }}>n={matrix.totalLostDeals}</span>
                  </div>
                </div>
                {[0, 1, 2, 3].map(ci => (
                  <div key={ci} style={{
                    padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 8,
                    borderRight: ci < 3 ? `1px solid ${colors.border}` : undefined,
                    minHeight: 60,
                  }}>
                    {(lostByCol[ci] ?? []).map(a => (
                      <LostCard
                        key={a.milestoneId}
                        absence={a}
                        deltaLostPct={
                          baselineLostPctById != null
                            ? a.lostDealPct - (baselineLostPctById[a.milestoneId] ?? a.lostDealPct)
                            : undefined
                        }
                      />
                    ))}
                    {(lostByCol[ci] ?? []).length === 0 && (
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 11, color: colors.textDim, fontFamily: font }}>—</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>

          {/* ── Detail panel ────────────────────────────────────────────────── */}
          {selectedMilestone && (
            <DetailPanel
              milestone={selectedMilestone}
              onClose={() => setSelected(null)}
            />
          )}

          {/* ── Synthesis card (All Pipelines view only) ────────────────────── */}
          {synthesis && !activePipeline && (
            <SynthesisCard
              text={synthesis}
              completedAt={completedAt ?? ''}
              periodDays={matrix.analysisPeriodDays}
            />
          )}
          {activePipeline && (
            <div style={{
              marginTop: 16, padding: '10px 16px',
              background: colors.surface, border: `1px solid ${colors.border}`,
              borderRadius: 8, fontSize: 12, color: colors.textMuted, fontFamily: font,
            }}>
              AI synthesis is available in the <strong style={{ color: colors.textSecondary }}>All Pipelines</strong> view — select it above to see the full analysis.
            </div>
          )}

          {/* ── Upgrade prompt ──────────────────────────────────────────────── */}
          <UpgradePrompt tier={matrix.tier} />
        </>
      )}
    </div>
  );
}
