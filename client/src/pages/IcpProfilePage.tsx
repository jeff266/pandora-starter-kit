import React, { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import Toast from '../components/Toast';

// ─── Types ────────────────────────────────────────────────────────────────────

type ScoringState = 'locked' | 'ready' | 'processing' | 'active';

interface ScoringStateResponse {
  state: ScoringState;
  processingStep?: number;
  [key: string]: unknown;
}

interface ReadinessSource {
  ready: boolean;
  accounts?: number;
  closedWonDeals?: number;
  closedLostDeals?: number;
  dealLinkageRate?: number;
  totalCalls?: number;
  wonDealCalls?: number;
  tier?: number;
  callsNeededForNextTier?: number;
  accountsEnriched?: number;
  accountsPending?: number;
  avgConfidence?: number;
}

interface ReadinessResponse {
  canRun: boolean;
  crm: ReadinessSource;
  conversations: ReadinessSource;
  enrichment: ReadinessSource;
  improvements?: string[];
}

interface IndustryEntry {
  name: string;
  win_rate?: number;
}

interface PainCluster {
  label: string;
  total?: number;
  won?: number;
  lift?: number;
}

interface BuyingCombo {
  roles: string[];
  win_rate?: number;
}

interface ScoringWeights {
  [key: string]: number;
}

interface IcpProfile {
  id: string;
  version: number;
  created_at: string;
  tier?: number;
  status: string;
  company_profile?: {
    industries?: Array<IndustryEntry | string>;
    size_ranges?: string[];
    disqualifiers?: string[];
  };
  conversation_insights?: {
    pain_point_clusters?: PainCluster[];
  };
  buying_committees?: BuyingCombo[];
  scoring_weights?: ScoringWeights;
}

interface ChangelogEntry {
  version: string;
  date: string;
  description: string;
  status?: string;
  changes?: string[];
  author?: string;
  impact?: string;
}

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

// ─── Step Indicator ───────────────────────────────────────────────────────────

function StepIndicator({ currentStep }: { currentStep: 1 | 2 | 3 }) {
  const steps = ['Data Readiness', 'Run Discovery', 'Review & Tune'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 28 }}>
      {steps.map((label, i) => {
        const stepNum = i + 1;
        const done = stepNum < currentStep;
        const active = stepNum === currentStep;
        return (
          <React.Fragment key={stepNum}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%',
                background: active ? colors.accent : done ? colors.accent : 'transparent',
                border: `2px solid ${active || done ? colors.accent : colors.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: active || done ? '#fff' : colors.textMuted,
              }}>
                {done ? '✓' : stepNum}
              </div>
              <span style={{
                fontSize: 11, fontWeight: active ? 600 : 400,
                color: active ? colors.text : colors.textMuted,
                whiteSpace: 'nowrap',
              }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                flex: 1, height: 1, margin: '0 10px', marginBottom: 18,
                background: done ? colors.accent : colors.border,
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Source Card ──────────────────────────────────────────────────────────────

function SourceCard({
  name, ready, statusLabel, details,
}: {
  name: string;
  ready: boolean;
  statusLabel: string;
  details: string[];
}) {
  return (
    <div style={{
      background: '#0F1319',
      border: `1px solid ${ready ? '#1E3A2F' : '#2A1F1A'}`,
      borderRadius: 10,
      padding: 20,
      flex: 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: ready ? colors.green : colors.yellow }}>{ready ? '✓' : '⚠'}</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#F1F5F9' }}>{name}</span>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 600,
          color: ready ? '#22C55E' : '#F59E0B',
          background: ready ? '#052E16' : '#1C1500',
          border: `1px solid ${ready ? '#166534' : '#78350F'}`,
          borderRadius: 20, padding: '2px 10px',
        }}>
          {statusLabel}
        </span>
      </div>
      {details.map((d, i) => (
        <div key={i} style={{ fontSize: 12, color: colors.textSecondary, marginTop: i > 0 ? 4 : 0 }}>
          {d}
        </div>
      ))}
    </div>
  );
}

// ─── Step 1: Data Readiness ───────────────────────────────────────────────────

function DataReadinessStep({ onActivate }: { onActivate: () => void }) {
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    api.get('/icp/readiness')
      .then((data: unknown) => setReadiness(data as ReadinessResponse))
      .catch(() => setReadiness(null))
      .finally(() => setLoading(false));
  }, []);

  const handleRun = async () => {
    setActivating(true);
    try {
      await api.post('/scoring/activate', {});
      onActivate();
    } catch {
      setActivating(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{
          width: 28, height: 28, border: `3px solid ${colors.border}`,
          borderTopColor: colors.accent, borderRadius: '50%',
          animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
        }} />
        <div style={{ fontSize: 13, color: colors.textMuted }}>Checking data readiness...</div>
      </div>
    );
  }

  const crm = readiness?.crm ?? { ready: false };
  const conv = readiness?.conversations ?? { ready: false };
  const enr = readiness?.enrichment ?? { ready: false };
  const canRun = readiness?.canRun ?? false;

  const crmDetails = [
    `${crm.accounts ?? 0} accounts · ${crm.closedWonDeals ?? 0} closed-won · ${crm.closedLostDeals ?? 0} closed-lost`,
    `Deal-to-account linkage: ${Math.round((crm.dealLinkageRate ?? 0) * 100)}%`,
  ];

  const convDetails = [
    `${conv.totalCalls ?? 0} calls · ${conv.wonDealCalls ?? 0} mapped to closed-won deals`,
    ...((conv.tier ?? 3) < 3
      ? [`⚠ ${conv.callsNeededForNextTier ?? 0} more won-deal calls needed for full tier`]
      : []),
  ];

  const enrDetails = [
    `${enr.accountsEnriched ?? 0} accounts enriched · ${enr.accountsPending ?? 0} pending`,
    `Avg confidence: ${Math.round(enr.avgConfidence ?? 0)}%`,
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <SourceCard
          name="CRM"
          ready={crm.ready}
          statusLabel={crm.ready ? 'Ready' : 'Needs Attention'}
          details={crmDetails}
        />
        <SourceCard
          name="Conversations"
          ready={conv.ready}
          statusLabel={conv.ready ? 'Ready' : 'Limited'}
          details={convDetails}
        />
        <SourceCard
          name="Enrichment"
          ready={enr.ready}
          statusLabel={enr.ready ? 'Ready' : 'Partial'}
          details={enrDetails}
        />
      </div>

      {readiness?.improvements && readiness.improvements.length > 0 && (
        <div style={{
          background: colors.surface, border: `1px solid ${colors.border}`,
          borderRadius: 8, padding: '14px 18px', marginBottom: 24,
          fontSize: 13, color: colors.textSecondary, lineHeight: 1.7,
        }}>
          <div style={{ marginBottom: 8 }}>
            You can proceed now. Connecting Apollo first would improve firmographic confidence.
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {readiness.improvements.map((imp, i) => (
              <li key={i}>{imp}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={handleRun}
          disabled={!canRun || activating}
          style={{
            padding: '10px 24px',
            background: canRun ? colors.accent : colors.surfaceHover,
            color: canRun ? '#fff' : colors.textMuted,
            border: 'none', borderRadius: 8,
            fontSize: 14, fontWeight: 600,
            cursor: canRun && !activating ? 'pointer' : 'not-allowed',
            opacity: activating ? 0.7 : 1,
            transition: 'all 0.2s',
          }}
        >
          {activating ? 'Starting...' : 'Run ICP Discovery →'}
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: Processing ───────────────────────────────────────────────────────

const PROCESSING_STEPS = [
  'Analyzing closed-won and closed-lost deals',
  'Identifying persona patterns across contacts',
  'Mining won-deal call transcripts',
  'Computing signal correlations',
  'Building scoring weights',
];

function ProcessingStep({
  onComplete,
  conversationsConnected,
}: {
  onComplete: () => void;
  conversationsConnected: boolean;
}) {
  const [processingStep, setProcessingStep] = useState(0);
  const [done, setDone] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = (await api.get('/scoring/state/poll')) as ScoringStateResponse;
      if (data.processingStep !== undefined) {
        setProcessingStep(data.processingStep);
      }
      if (data.state === 'active') {
        setDone(true);
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    } catch {
      // silently continue polling
    }
  }, []);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [poll]);

  const steps = PROCESSING_STEPS.map((label, i) => {
    if (i === 2 && !conversationsConnected) {
      return 'Skipping conversation mining — no CI data';
    }
    return label;
  });

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        {steps.map((label, i) => {
          const isDone = i < processingStep;
          const isActive = i === processingStep && !done;
          const isPending = i > processingStep && !done;

          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 0',
              borderBottom: i < steps.length - 1 ? `1px solid ${colors.border}` : 'none',
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                background: isDone
                  ? colors.accent
                  : isActive
                    ? 'transparent'
                    : 'transparent',
                border: `2px solid ${isDone ? colors.accent : isActive ? colors.accent : colors.border}`,
                color: isDone ? '#fff' : isActive ? colors.accent : colors.textMuted,
                ...(isActive ? { animation: 'pulse 1.2s ease-in-out infinite' } : {}),
              }}>
                {isDone ? '✓' : isActive ? '●' : '○'}
              </div>
              <span style={{
                fontSize: 13,
                color: isDone ? colors.textSecondary : isActive ? colors.text : colors.textMuted,
                fontWeight: isActive ? 500 : 400,
              }}>
                {label}
              </span>
              {isActive && (
                <span style={{ fontSize: 11, color: colors.accent, marginLeft: 'auto' }}>
                  In progress...
                </span>
              )}
            </div>
          );
        })}
      </div>

      {done && (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <div style={{
            fontSize: 14, color: colors.green, fontWeight: 600, marginBottom: 8,
          }}>
            ICP Discovery complete!
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 20 }}>
            Your ICP profile has been built. Review the dossier to tune weights and add disqualifiers.
          </div>
          <button
            onClick={onComplete}
            style={{
              padding: '10px 24px', background: colors.accent,
              color: '#fff', border: 'none', borderRadius: 8,
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Review ICP Dossier →
          </button>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

// ─── Changelog Modal ──────────────────────────────────────────────────────────

function ChangelogModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/icp/changelog')
      .then((data: unknown) => {
        const arr = Array.isArray(data) ? data : (data as { entries?: ChangelogEntry[] }).entries ?? [];
        setEntries(arr as ChangelogEntry[]);
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: colors.surface, border: `1px solid ${colors.border}`,
          borderRadius: 12, padding: 28, width: 580, maxWidth: '90vw',
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: colors.text }}>ICP Changelog</span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: colors.textMuted,
              fontSize: 18, cursor: 'pointer', padding: '0 4px',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
              Loading changelog...
            </div>
          ) : entries.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
              No changelog entries yet.
            </div>
          ) : (
            entries.map((entry, i) => (
              <div key={i} style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 700, color: colors.accent, fontFamily: fonts.mono,
                  }}>
                    v{entry.version}
                  </span>
                  <span style={{ fontSize: 12, color: colors.textMuted }}>
                    {entry.date}
                  </span>
                  <span style={{ fontSize: 12, color: colors.textSecondary, flex: 1 }}>
                    {entry.description}
                  </span>
                  {entry.status && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                      background: entry.status === 'ACTIVE' ? '#052E16' : colors.surfaceHover,
                      color: entry.status === 'ACTIVE' ? colors.green : colors.textMuted,
                      border: `1px solid ${entry.status === 'ACTIVE' ? '#166534' : colors.border}`,
                    }}>
                      {entry.status}
                    </span>
                  )}
                </div>
                {entry.author && (
                  <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 6 }}>
                    {entry.author}
                  </div>
                )}
                <div style={{ height: 1, background: colors.border, marginBottom: 8 }} />
                {entry.changes && entry.changes.map((ch, j) => (
                  <div key={j} style={{
                    fontSize: 12, color: colors.textSecondary,
                    fontFamily: fonts.mono, padding: '2px 0',
                  }}>
                    {ch}
                  </div>
                ))}
                {entry.impact && (
                  <div style={{
                    fontSize: 12, color: colors.yellow, marginTop: 6,
                    fontFamily: fonts.mono,
                  }}>
                    {entry.impact}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Section Header with Edit Button ─────────────────────────────────────────

function SectionHeader({
  title, onEdit,
}: {
  title: string;
  onEdit: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 12, marginTop: 28,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
        color: colors.textDim, textTransform: 'uppercase',
      }}>
        {title}
      </span>
      <button
        onClick={onEdit}
        style={{
          background: 'none', border: `1px solid ${colors.border}`,
          color: colors.textMuted, fontSize: 11, borderRadius: 5,
          padding: '2px 10px', cursor: 'pointer',
        }}
      >
        edit
      </button>
    </div>
  );
}

// ─── Inline Edit Area ─────────────────────────────────────────────────────────

function InlineEditArea({
  initial, onSave, onCancel,
}: {
  initial: string;
  onSave: (value: string, note: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [note, setNote] = useState('');

  return (
    <div style={{
      border: `1px solid ${colors.accent}`, borderRadius: 8,
      padding: 14, marginBottom: 16, background: colors.surfaceRaised,
    }}>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        rows={4}
        style={{
          width: '100%', background: 'transparent', border: 'none',
          color: colors.text, fontSize: 13, resize: 'vertical',
          outline: 'none', fontFamily: fonts.sans, boxSizing: 'border-box',
        }}
      />
      <input
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Note about this change (optional)"
        style={{
          width: '100%', background: colors.surfaceHover, border: `1px solid ${colors.border}`,
          borderRadius: 5, color: colors.textSecondary, fontSize: 12, padding: '6px 10px',
          outline: 'none', marginTop: 8, boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <button
          onClick={onCancel}
          style={{
            padding: '6px 14px', border: `1px solid ${colors.border}`,
            background: 'transparent', color: colors.textSecondary,
            borderRadius: 5, fontSize: 12, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(value, note)}
          style={{
            padding: '6px 14px', border: 'none', background: colors.accent,
            color: '#fff', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ─── Dossier View ─────────────────────────────────────────────────────────────

function DossierView({ addToast, conversationsConnected }: { addToast: (msg: string, type: 'success' | 'error' | 'info') => void; conversationsConnected: boolean }) {
  const [profile, setProfile] = useState<IcpProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [editingSection, setEditingSection] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      const data = (await api.get('/icp/profiles?status=active')) as unknown;
      const arr = Array.isArray(data) ? data : (data as { profiles?: IcpProfile[] }).profiles ?? [data];
      setProfile(arr[0] as IcpProfile ?? null);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleSave = async (field: string, value: string, note: string) => {
    if (!profile) return;
    try {
      await api.patch(`/icp/profiles/${profile.id}`, {
        field,
        value,
        note,
        changedBy: 'User',
      });
      addToast('ICP profile updated', 'success');
      setEditingSection(null);
      fetchProfile();
    } catch {
      addToast('Failed to save changes', 'error');
    }
  };

  const handleRerun = async () => {
    setRerunning(true);
    try {
      await api.post('/scoring/activate', {});
      addToast('ICP Discovery re-run started. This may take a few minutes.', 'info');
      // Refresh profile once backend confirms activation
      setTimeout(() => fetchProfile(), 3000);
    } catch {
      addToast('Failed to start re-run', 'error');
    } finally {
      setRerunning(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{
          width: 28, height: 28, border: `3px solid ${colors.border}`,
          borderTopColor: colors.accent, borderRadius: '50%',
          animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
        }} />
        <div style={{ fontSize: 13, color: colors.textMuted }}>Loading ICP dossier...</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: colors.textMuted, fontSize: 14 }}>
        No active ICP profile found.
      </div>
    );
  }

  const versionDate = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const tier = profile.tier ?? 1;

  // Industries
  const industries = profile.company_profile?.industries ?? [];
  const industryEntries: IndustryEntry[] = industries.map(ind =>
    typeof ind === 'string' ? { name: ind } : ind as IndustryEntry
  );
  const rates = industryEntries.map(e => e.win_rate ?? 0).filter(r => r > 0);
  const baseline = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;

  // Buying triggers
  const clusters = profile.conversation_insights?.pain_point_clusters ?? [];

  // Buying committee combos
  const committees = profile.buying_committees ?? [];
  const topCombos = [...committees]
    .sort((a, b) => (b.win_rate ?? 0) - (a.win_rate ?? 0))
    .slice(0, 2);

  // Disqualifiers
  const disqualifiers = profile.company_profile?.disqualifiers ?? [];

  // Scoring weights
  const weights = profile.scoring_weights ?? {};

  return (
    <div>
      {/* Dossier header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 24, flexWrap: 'wrap', gap: 12,
      }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>ICP Profile</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: colors.textMuted }}>
            v{profile.version} · {versionDate} · Tier {tier} of 3
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleRerun}
              disabled={rerunning}
              style={{
                padding: '6px 14px', border: `1px solid ${colors.border}`,
                background: 'transparent', color: rerunning ? colors.textMuted : colors.textSecondary,
                borderRadius: 6, fontSize: 12, cursor: rerunning ? 'not-allowed' : 'pointer',
                opacity: rerunning ? 0.6 : 1,
              }}
            >
              {rerunning ? 'Starting...' : 'Re-run'}
            </button>
            <button
              onClick={() => setShowChangelog(true)}
              style={{
                padding: '6px 14px', border: `1px solid ${colors.border}`,
                background: 'transparent', color: colors.textSecondary,
                borderRadius: 6, fontSize: 12, cursor: 'pointer',
              }}
            >
              Changelog
            </button>
            <button
              onClick={() => addToast('Export coming soon', 'info')}
              style={{
                padding: '6px 14px', border: `1px solid ${colors.border}`,
                background: 'transparent', color: colors.textSecondary,
                borderRadius: 6, fontSize: 12, cursor: 'pointer',
              }}
            >
              Export
            </button>
          </div>
        </div>
      </div>

      {/* IDEAL COMPANY */}
      <SectionHeader title="Ideal Company" onEdit={() => setEditingSection(editingSection === 'industries' ? null : 'industries')} />
      {editingSection === 'industries' && (
        <InlineEditArea
          initial={industryEntries.map(e => e.name).join('\n')}
          onSave={(v, n) => handleSave('company_profile.industries', v, n)}
          onCancel={() => setEditingSection(null)}
        />
      )}
      {industryEntries.length > 0 ? (
        <div style={{
          border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden',
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 80px 60px 1fr',
            padding: '8px 14px', background: colors.surfaceRaised,
            fontSize: 11, fontWeight: 600, color: colors.textMuted, letterSpacing: '0.06em',
          }}>
            <span>Industry</span>
            <span style={{ textAlign: 'right' }}>Win Rate</span>
            <span style={{ textAlign: 'right' }}>Lift</span>
            <span />
          </div>
          {industryEntries.map((ind, i) => {
            const wr = ind.win_rate ?? 0;
            const lift = baseline > 0 ? wr / baseline : 0;
            const barPct = baseline > 0 ? Math.min((wr / (baseline * 2)) * 100, 100) : 50;
            return (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '1fr 80px 60px 1fr',
                padding: '10px 14px', alignItems: 'center',
                borderTop: `1px solid ${colors.border}`,
                fontSize: 13, color: colors.text,
              }}>
                <span>{ind.name}</span>
                <span style={{ textAlign: 'right', fontFamily: fonts.mono, color: colors.textSecondary }}>
                  {wr > 0 ? `${Math.round(wr * 100)}%` : '—'}
                </span>
                <span style={{ textAlign: 'right', fontFamily: fonts.mono, color: lift >= 1.5 ? colors.green : colors.textSecondary }}>
                  {lift > 0 ? `${lift.toFixed(1)}×` : '—'}
                </span>
                <div style={{ paddingLeft: 12 }}>
                  {wr > 0 && (
                    <div style={{
                      height: 4, background: colors.surfaceHover, borderRadius: 2, overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%', width: `${barPct}%`,
                        background: colors.accent, borderRadius: 2,
                        transition: 'width 0.4s',
                      }} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: colors.textMuted, padding: '8px 0' }}>
          No industry data yet.
        </div>
      )}

      {/* Size ranges */}
      {profile.company_profile?.size_ranges && profile.company_profile.size_ranges.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {profile.company_profile.size_ranges.map((sz, i) => (
            <span key={i} style={{
              fontSize: 12, padding: '4px 12px', borderRadius: 20,
              background: colors.surfaceHover, border: `1px solid ${colors.border}`,
              color: colors.textSecondary,
            }}>
              {sz}
            </span>
          ))}
        </div>
      )}

      {/* BUYING TRIGGERS */}
      <SectionHeader title="Buying Triggers" onEdit={() => setEditingSection(editingSection === 'triggers' ? null : 'triggers')} />
      {editingSection === 'triggers' && (
        <InlineEditArea
          initial={clusters.map(c => c.label).join('\n')}
          onSave={(v, n) => handleSave('conversation_insights.pain_point_clusters', v, n)}
          onCancel={() => setEditingSection(null)}
        />
      )}
      {clusters.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {clusters.map((c, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: '10px 14px', background: colors.surface,
              border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 13,
            }}>
              <span style={{ flex: 1, color: colors.text, fontStyle: 'italic' }}>"{c.label}"</span>
              {c.total != null && c.won != null && (
                <span style={{ color: colors.textMuted, fontFamily: fonts.mono, fontSize: 12 }}>
                  {c.won}/{c.total} calls
                </span>
              )}
              {c.lift != null && (
                <span style={{
                  color: colors.green, fontFamily: fonts.mono, fontSize: 12, fontWeight: 600,
                }}>
                  {c.lift.toFixed(1)}× lift
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          padding: '16px 18px', background: colors.surfaceHover,
          border: `1px solid ${colors.border}`, borderRadius: 8,
          fontSize: 13, color: colors.textMuted,
        }}>
          {conversationsConnected
            ? 'No buying triggers extracted yet. Re-run ICP Discovery to analyze your call data.'
            : 'Connect Gong or Fireflies and re-run ICP Discovery to unlock buying triggers.'}
        </div>
      )}

      {/* BUYING COMMITTEE */}
      <SectionHeader title="Buying Committee" onEdit={() => setEditingSection(editingSection === 'committee' ? null : 'committee')} />
      {editingSection === 'committee' && (
        <InlineEditArea
          initial={topCombos.map(c => (c.roles ?? []).join(', ')).join('\n')}
          onSave={(v, n) => handleSave('buying_committees', v, n)}
          onCancel={() => setEditingSection(null)}
        />
      )}
      {topCombos.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {topCombos.map((combo, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px', background: colors.surface,
              border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 13,
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: colors.textMuted }}>#{i + 1}</span>
              <span style={{ flex: 1, color: colors.text }}>
                {(combo.roles ?? []).join(' + ')}
              </span>
              {combo.win_rate != null && (
                <span style={{
                  fontSize: 12, fontFamily: fonts.mono, color: colors.green, fontWeight: 600,
                }}>
                  {Math.round(combo.win_rate * 100)}% win rate
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: colors.textMuted, padding: '8px 0' }}>
          No buying committee data yet.
        </div>
      )}

      {/* DO NOT PURSUE */}
      <SectionHeader title="Do Not Pursue" onEdit={() => setEditingSection(editingSection === 'disqualifiers' ? null : 'disqualifiers')} />
      {editingSection === 'disqualifiers' && (
        <InlineEditArea
          initial={disqualifiers.join('\n')}
          onSave={(v, n) => handleSave('company_profile.disqualifiers', v, n)}
          onCancel={() => setEditingSection(null)}
        />
      )}
      {disqualifiers.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {disqualifiers.map((d, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 14px', background: 'rgba(239,68,68,0.05)',
              border: `1px solid rgba(239,68,68,0.2)`, borderRadius: 8, fontSize: 13,
            }}>
              <span style={{ color: colors.red }}>✕</span>
              <span style={{ color: colors.textSecondary }}>{d}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          padding: '10px 14px', background: colors.surfaceHover,
          border: `1px solid ${colors.border}`, borderRadius: 8,
          fontSize: 13, color: colors.textMuted, fontStyle: 'italic',
        }}>
          [edit to add disqualifiers]
        </div>
      )}

      {/* SCORE WEIGHTS */}
      <SectionHeader title="Score Weights" onEdit={() => setEditingSection(editingSection === 'weights' ? null : 'weights')} />
      {editingSection === 'weights' && (
        <InlineEditArea
          initial={JSON.stringify(weights, null, 2)}
          onSave={(v, n) => handleSave('scoring_weights', v, n)}
          onCancel={() => setEditingSection(null)}
        />
      )}
      {Object.keys(weights).length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(weights).map(([key, val]) => {
            const pct = typeof val === 'number' ? val * 100 : 0;
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            return (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 14px', background: colors.surface,
                border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 13,
              }}>
                <span style={{ flex: 1, color: colors.textSecondary }}>{label}</span>
                <span style={{ fontFamily: fonts.mono, color: colors.text, minWidth: 40, textAlign: 'right' }}>
                  {Math.round(pct)}%
                </span>
                <div style={{
                  width: 80, height: 4, background: colors.surfaceHover, borderRadius: 2, overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%', width: `${Math.min(pct, 100)}%`,
                    background: colors.accent, borderRadius: 2,
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: colors.textMuted, padding: '8px 0' }}>
          No scoring weights configured.
        </div>
      )}

      {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IcpProfilePage() {
  const [scoringState, setScoringState] = useState<ScoringState | null>(null);
  const [loading, setLoading] = useState(true);
  const [conversationsConnected, setConversationsConnected] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);

  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    Promise.all([
      api.get('/scoring/state'),
      api.get('/icp/readiness').catch(() => null),
    ]).then(([stateRes, readinessRes]) => {
      const sr = stateRes as ScoringStateResponse;
      setScoringState(sr.state);
      if (readinessRes) {
        const rr = readinessRes as ReadinessResponse;
        setConversationsConnected(rr.conversations?.ready ?? false);
      }
    }).catch(() => {
      setScoringState('locked');
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  const handleActivate = () => setScoringState('processing');
  const handleComplete = () => setScoringState('active');

  // Determine which wizard step to show
  const wizardStep: 1 | 2 | 3 =
    scoringState === 'processing' ? 2 :
    scoringState === 'active' ? 3 : 1;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <div style={{
          width: 28, height: 28, border: `3px solid ${colors.border}`,
          borderTopColor: colors.accent, borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, fontFamily: fonts.sans }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {scoringState === 'active' ? (
        <DossierView addToast={addToast} conversationsConnected={conversationsConnected} />
      ) : (
        <div style={{
          background: colors.surface, border: `1px solid ${colors.border}`,
          borderRadius: 12, padding: 28,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>ICP Profile</span>
          </div>

          <StepIndicator currentStep={wizardStep} />

          <div style={{ height: 1, background: colors.border, marginBottom: 28 }} />

          {wizardStep === 1 && (
            <DataReadinessStep onActivate={handleActivate} />
          )}
          {wizardStep === 2 && (
            <ProcessingStep
              onComplete={handleComplete}
              conversationsConnected={conversationsConnected}
            />
          )}
        </div>
      )}

      {toasts.map(toast => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}
