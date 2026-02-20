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
  ready?: boolean;
  connected?: boolean;
  configured?: boolean;
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
  roles?: string[];
  personaNames?: string[];
  personas?: string[];
  win_rate?: number;
  winRate?: number;
  lift?: number;
  wonCount?: number;
  lostCount?: number;
  totalCount?: number;
  avgDealSize?: number;
}

interface IndustryWinRate {
  industry: string;
  winRate: number;
  count: number;
  avgDeal: number;
}

interface SizeWinRate {
  bucket: string;
  winRate: number;
  count: number;
  avgDeal: number;
}

interface IcpProfile {
  id: string;
  version: number;
  created_at: string;
  status: string;
  won_deals?: number;
  deals_analyzed?: number;
  company_profile?: {
    industries?: Array<IndustryEntry | string>;
    industryWinRates?: IndustryWinRate[];
    size_ranges?: string[];
    sizeWinRates?: SizeWinRate[];
    disqualifiers?: string[];
    sweetSpots?: Array<{ description: string; winRate: number; lift: number; count: number; avgDeal: number }>;
    signal_analysis?: {
      signal_types?: Array<{ type: string; lift: number; won_rate: number; count_won: number }>;
      hiring_lift?: number;
      funding_lift?: number;
      expansion_lift?: number;
      risk_lift?: number;
    };
  };
  conversation_insights?: {
    pain_point_clusters?: PainCluster[];
  };
  buying_committees?: BuyingCombo[];
  scoring_weights?: Record<string, unknown>;
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

interface TaxonomyDimension {
  key: string;
  label: string;
  ideal_values: string[];
  win_rate: number;
  lift: number;
  why_it_matters: string;
  data_source: string;
}

interface TaxonomyNegativeIndicator {
  dimension: string;
  value: string;
  win_rate: number;
  recommendation: string;
}

interface TaxonomyArchetype {
  name: string;
  deal_count: number;
  description: string;
  example_accounts: string[];
}

interface TaxonomyReport {
  icp_summary: string;
  top_dimensions: TaxonomyDimension[];
  negative_indicators: TaxonomyNegativeIndicator[];
  archetypes: TaxonomyArchetype[];
  confidence: string;
  confidence_notes: string;
}

interface TaxonomyData {
  id: string;
  scope_id: string;
  vertical: string;
  taxonomy_report: TaxonomyReport;
  accounts_analyzed: number;
  won_deals_count: number;
  serper_searches: number;
  generated_at: string;
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

  const crm = readiness?.crm ?? {};
  const conv = readiness?.conversations ?? {};
  const enr = readiness?.enrichment ?? {};
  const canRun = readiness?.canRun ?? false;

  const crmReady = crm.ready ?? (crm.connected ?? false);
  const convReady = conv.connected ?? (conv.ready ?? false);
  const enrReady = enr.configured ?? (enr.ready ?? false);

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
          ready={crmReady}
          statusLabel={crmReady ? 'Ready' : 'Needs Attention'}
          details={crmDetails}
        />
        <SourceCard
          name="Conversations"
          ready={convReady}
          statusLabel={convReady ? 'Connected' : 'Not Connected'}
          details={convDetails}
        />
        <SourceCard
          name="Enrichment"
          ready={enrReady}
          statusLabel={enrReady ? 'Ready' : 'Partial'}
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

// ─── Taxonomy Pro View ────────────────────────────────────────────────────────

function TaxonomyProView({ addToast }: { addToast: (msg: string, type: 'success' | 'error' | 'info') => void }) {
  const [taxonomy, setTaxonomy] = useState<TaxonomyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/icp/taxonomy')
      .then((data: unknown) => {
        const resp = data as { taxonomy?: TaxonomyData | null };
        setTaxonomy(resp.taxonomy ?? null);
      })
      .catch((err: Error) => {
        addToast(err.message || 'Failed to load taxonomy data', 'error');
        setTaxonomy(null);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{
          width: 28, height: 28, border: `3px solid ${colors.border}`,
          borderTopColor: colors.accent, borderRadius: '50%',
          animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
        }} />
        <div style={{ fontSize: 13, color: colors.textMuted }}>Loading taxonomy...</div>
      </div>
    );
  }

  if (!taxonomy || !taxonomy.taxonomy_report) {
    return (
      <div style={{
        padding: '40px 20px', textAlign: 'center', color: colors.textMuted,
        background: colors.surfaceHover, border: `1px solid ${colors.border}`,
        borderRadius: 10, fontSize: 14,
      }}>
        <div style={{ fontSize: 18, marginBottom: 8 }}>No taxonomy data yet</div>
        <div style={{ fontSize: 13 }}>
          Run the ICP Taxonomy Builder skill to generate web-enriched customer intelligence.
        </div>
      </div>
    );
  }

  const report = taxonomy.taxonomy_report;
  const generatedDate = new Date(taxonomy.generated_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  const confidenceColor = report.confidence === 'high' ? colors.green
    : report.confidence === 'medium' ? colors.yellow : colors.red;

  return (
    <div>
      {/* ICP Summary Banner */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(100,136,234,0.08), rgba(100,136,234,0.02))',
        border: `1px solid ${colors.accent}33`,
        borderRadius: 10, padding: '20px 24px', marginBottom: 24,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
              color: colors.accent, textTransform: 'uppercase',
            }}>
              ICP Summary
            </span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
              background: taxonomy.vertical === 'healthcare' ? '#052E16' : colors.surfaceHover,
              color: taxonomy.vertical === 'healthcare' ? colors.green : colors.textMuted,
              border: `1px solid ${taxonomy.vertical === 'healthcare' ? '#166534' : colors.border}`,
              textTransform: 'capitalize',
            }}>
              {taxonomy.vertical}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              fontSize: 11, color: confidenceColor, fontWeight: 600,
              textTransform: 'capitalize',
            }}>
              {report.confidence} confidence
            </span>
            <span style={{ fontSize: 11, color: colors.textMuted }}>
              {generatedDate}
            </span>
          </div>
        </div>
        <div style={{ fontSize: 14, color: colors.text, lineHeight: 1.6 }}>
          {report.icp_summary}
        </div>
        {report.confidence_notes && (
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 8, fontStyle: 'italic' }}>
            {report.confidence_notes}
          </div>
        )}
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Accounts Analyzed', value: taxonomy.accounts_analyzed },
          { label: 'Won Deals', value: taxonomy.won_deals_count },
          { label: 'Web Searches', value: taxonomy.serper_searches },
          { label: 'Dimensions', value: report.top_dimensions?.length ?? 0 },
        ].map((stat, i) => (
          <div key={i} style={{
            flex: 1, padding: '14px 16px', background: colors.surface,
            border: `1px solid ${colors.border}`, borderRadius: 8, textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.mono }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Top Dimensions */}
      {report.top_dimensions && report.top_dimensions.length > 0 && (
        <>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
            color: colors.textDim, textTransform: 'uppercase',
            marginBottom: 12, marginTop: 8,
          }}>
            Top Dimensions
          </div>
          <div style={{
            border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden',
            marginBottom: 24,
          }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '140px 1fr 80px 60px',
              padding: '8px 14px', background: colors.surfaceRaised,
              fontSize: 11, fontWeight: 600, color: colors.textMuted, letterSpacing: '0.06em',
            }}>
              <span>Dimension</span>
              <span>Ideal Values</span>
              <span style={{ textAlign: 'right' }}>Win Rate</span>
              <span style={{ textAlign: 'right' }}>Lift</span>
            </div>
            {report.top_dimensions.map((dim, i) => (
              <div key={i}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '140px 1fr 80px 60px',
                  padding: '12px 14px', alignItems: 'center',
                  borderTop: `1px solid ${colors.border}`, fontSize: 13,
                }}>
                  <span style={{ color: colors.text, fontWeight: 500 }}>{dim.label}</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {dim.ideal_values.map((v, j) => (
                      <span key={j} style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                        background: colors.surfaceHover, color: colors.text,
                        border: `1px solid ${colors.border}`,
                      }}>
                        {v}
                      </span>
                    ))}
                  </div>
                  <span style={{
                    textAlign: 'right', fontFamily: fonts.mono, color: colors.textSecondary,
                  }}>
                    {dim.win_rate > 0 ? `${Math.round(dim.win_rate * 100)}%` : '—'}
                  </span>
                  <span style={{
                    textAlign: 'right', fontFamily: fonts.mono,
                    color: dim.lift >= 1.5 ? colors.green : colors.textSecondary,
                    fontWeight: dim.lift >= 1.5 ? 600 : 400,
                  }}>
                    {dim.lift > 0 ? `${dim.lift.toFixed(1)}x` : '—'}
                  </span>
                </div>
                {dim.why_it_matters && (
                  <div style={{
                    padding: '0 14px 10px 14px', fontSize: 12,
                    color: colors.textMuted, lineHeight: 1.5,
                  }}>
                    {dim.why_it_matters}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Customer Archetypes */}
      {report.archetypes && report.archetypes.length > 0 && (
        <>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
            color: colors.textDim, textTransform: 'uppercase',
            marginBottom: 12,
          }}>
            Customer Archetypes
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
            {report.archetypes.map((arch, i) => (
              <div key={i} style={{
                padding: '16px 18px', background: colors.surface,
                border: `1px solid ${colors.border}`, borderRadius: 10,
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 8,
                }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>
                    {arch.name}
                  </span>
                  <span style={{
                    fontSize: 11, fontFamily: fonts.mono, color: colors.accent,
                    fontWeight: 600,
                  }}>
                    ~{arch.deal_count} deals
                  </span>
                </div>
                <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.5, marginBottom: 10 }}>
                  {arch.description}
                </div>
                {arch.example_accounts && arch.example_accounts.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {arch.example_accounts.slice(0, 5).map((acc, j) => (
                      <span key={j} style={{
                        fontSize: 11, padding: '3px 10px', borderRadius: 12,
                        background: 'rgba(100,136,234,0.08)',
                        border: `1px solid ${colors.accent}22`,
                        color: colors.accent,
                      }}>
                        {acc}
                      </span>
                    ))}
                    {arch.example_accounts.length > 5 && (
                      <span style={{
                        fontSize: 11, padding: '3px 10px', color: colors.textMuted,
                      }}>
                        +{arch.example_accounts.length - 5} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Negative Indicators */}
      {report.negative_indicators && report.negative_indicators.length > 0 && (
        <>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
            color: colors.textDim, textTransform: 'uppercase',
            marginBottom: 12,
          }}>
            Negative Indicators
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            {report.negative_indicators.map((neg, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '10px 14px',
                background: 'rgba(239,68,68,0.04)',
                border: `1px solid rgba(239,68,68,0.15)`,
                borderRadius: 8, fontSize: 13,
              }}>
                <span style={{ color: colors.red, flexShrink: 0 }}>!</span>
                <div style={{ flex: 1 }}>
                  <span style={{ color: colors.text, fontWeight: 500 }}>
                    {neg.value}
                  </span>
                  <span style={{ color: colors.textMuted }}> ({neg.dimension})</span>
                  {neg.recommendation && (
                    <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                      {neg.recommendation}
                    </div>
                  )}
                </div>
                <span style={{
                  fontFamily: fonts.mono, fontSize: 12,
                  color: neg.win_rate === 0 ? colors.red : colors.yellow,
                  fontWeight: 600, flexShrink: 0,
                }}>
                  {Math.round(neg.win_rate * 100)}% win
                </span>
              </div>
            ))}
          </div>
        </>
      )}
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
  const [activeTab, setActiveTab] = useState<'advanced' | 'pro'>('advanced');

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
      // Poll until state leaves 'processing', then refresh profile
      const poll = async () => {
        try {
          const res = (await api.get('/scoring/state/poll')) as { state?: string };
          if (res.state !== 'processing') {
            setRerunning(false);
            fetchProfile();
          } else {
            setTimeout(poll, 5000);
          }
        } catch {
          setRerunning(false);
        }
      };
      setTimeout(poll, 5000);
    } catch {
      addToast('Failed to start re-run', 'error');
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

  const wonDeals = profile.won_deals ?? 0;
  const tier = wonDeals >= 200 ? 3 : wonDeals >= 100 ? 2 : 1;

  const iwRates = profile.company_profile?.industryWinRates ?? [];
  const oldIndustries = profile.company_profile?.industries ?? [];
  const industryEntries: IndustryEntry[] = iwRates.length > 0
    ? iwRates.map(iw => ({ name: iw.industry, win_rate: iw.winRate }))
    : oldIndustries.map(ind => typeof ind === 'string' ? { name: ind } : ind as IndustryEntry);
  const rates = industryEntries.map(e => e.win_rate ?? 0).filter(r => r > 0);
  const baseline = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;

  const sizeRates = profile.company_profile?.sizeWinRates ?? [];

  const clusters = profile.conversation_insights?.pain_point_clusters ?? [];

  const committees = profile.buying_committees ?? [];
  const topCombos = [...committees]
    .sort((a, b) => (b.winRate ?? b.win_rate ?? 0) - (a.winRate ?? a.win_rate ?? 0))
    .slice(0, 5);

  const disqualifiers = profile.company_profile?.disqualifiers ?? [];

  const rawWeights = profile.scoring_weights ?? {};
  const flatWeights: Record<string, number> = {};
  for (const [section, val] of Object.entries(rawWeights)) {
    if (section === 'method' || section === 'note') continue;
    if (typeof val === 'number') {
      flatWeights[section] = val;
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      for (const [subKey, subVal] of Object.entries(val as Record<string, unknown>)) {
        if (typeof subVal === 'number') {
          flatWeights[subKey] = subVal;
        }
      }
    }
  }
  const maxWeight = Math.max(...Object.values(flatWeights), 1);

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
                padding: '6px 14px', border: `1px solid ${rerunning ? colors.accent : colors.border}`,
                background: 'transparent', color: rerunning ? colors.accent : colors.textSecondary,
                borderRadius: 6, fontSize: 12, cursor: rerunning ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {rerunning && (
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: colors.accent,
                  display: 'inline-block',
                  animation: 'skeleton-pulse 1.2s ease-in-out infinite',
                }} />
              )}
              {rerunning ? 'Running...' : 'Re-run'}
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

      {/* Running banner */}
      {rerunning && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', marginBottom: 20,
          background: 'rgba(100,136,234,0.08)', border: `1px solid ${colors.accent}`,
          borderRadius: 8, fontSize: 13, color: colors.accent,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: colors.accent, flexShrink: 0,
            animation: 'skeleton-pulse 1.2s ease-in-out infinite',
          }} />
          ICP Discovery is running — enriching accounts and analyzing deal patterns. This page will refresh automatically when complete.
        </div>
      )}

      {/* Tab Switcher */}
      <div style={{
        display: 'flex', gap: 0, marginBottom: 24,
        borderBottom: `1px solid ${colors.border}`,
      }}>
        {(['advanced', 'pro'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 20px',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${activeTab === tab ? colors.accent : 'transparent'}`,
              color: activeTab === tab ? colors.text : colors.textMuted,
              fontSize: 13,
              fontWeight: activeTab === tab ? 600 : 400,
              cursor: 'pointer',
              transition: 'all 0.2s',
              textTransform: 'capitalize',
              marginBottom: -1,
            }}
          >
            {tab === 'advanced' ? 'Advanced' : 'Pro'}
          </button>
        ))}
      </div>

      {activeTab === 'pro' && (
        <TaxonomyProView addToast={addToast} />
      )}

      {activeTab === 'advanced' && (<>
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
      {sizeRates.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, letterSpacing: '0.06em', marginBottom: 8 }}>
            COMPANY SIZE
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {sizeRates.filter(s => s.count > 0).map((sz, i) => (
              <div key={i} style={{
                fontSize: 12, padding: '6px 14px', borderRadius: 8,
                background: colors.surface, border: `1px solid ${colors.border}`,
                color: colors.text, display: 'flex', gap: 8, alignItems: 'center',
              }}>
                <span>{sz.bucket} employees</span>
                <span style={{ color: colors.textMuted, fontFamily: fonts.mono }}>
                  {Math.round(sz.winRate * 100)}% win · {sz.count} deals
                </span>
              </div>
            ))}
          </div>
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
          initial={topCombos.map(c => (c.personaNames ?? c.roles ?? []).join(', ')).join('\n')}
          onSave={(v, n) => handleSave('buying_committees', v, n)}
          onCancel={() => setEditingSection(null)}
        />
      )}
      {topCombos.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {topCombos.map((combo, i) => {
            const names = combo.personaNames ?? combo.roles ?? [];
            const wr = combo.winRate ?? combo.win_rate;
            const lift = combo.lift;
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', background: colors.surface,
                border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 13,
              }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: colors.textMuted }}>#{i + 1}</span>
                <span style={{ flex: 1, color: colors.text }}>
                  {names.join(' + ')}
                </span>
                {wr != null && (
                  <span style={{
                    fontSize: 12, fontFamily: fonts.mono, color: colors.green, fontWeight: 600,
                  }}>
                    {Math.round(wr * 100)}% win rate
                  </span>
                )}
                {lift != null && lift > 1 && (
                  <span style={{
                    fontSize: 12, fontFamily: fonts.mono, color: colors.accent, fontWeight: 600,
                  }}>
                    {lift.toFixed(1)}× lift
                  </span>
                )}
                {combo.wonCount != null && combo.totalCount != null && (
                  <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.mono }}>
                    {combo.wonCount}/{combo.totalCount}
                  </span>
                )}
              </div>
            );
          })}
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
          initial={JSON.stringify(rawWeights, null, 2)}
          onSave={(v, n) => handleSave('scoring_weights', v, n)}
          onCancel={() => setEditingSection(null)}
        />
      )}
      {Object.keys(flatWeights).length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(flatWeights)
            .sort(([, a], [, b]) => b - a)
            .map(([key, val]) => {
            const barPct = maxWeight > 0 ? (val / maxWeight) * 100 : 0;
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            return (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 14px', background: colors.surface,
                border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 13,
              }}>
                <span style={{ flex: 1, color: colors.textSecondary }}>{label}</span>
                <span style={{ fontFamily: fonts.mono, color: colors.text, minWidth: 40, textAlign: 'right' }}>
                  {val}
                </span>
                <div style={{
                  width: 80, height: 4, background: colors.surfaceHover, borderRadius: 2, overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%', width: `${Math.min(barPct, 100)}%`,
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

      </>)}

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
        setConversationsConnected(rr.conversations?.connected ?? rr.conversations?.ready ?? false);
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
