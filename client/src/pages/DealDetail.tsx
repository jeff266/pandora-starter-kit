import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatDate, formatTimeAgo, severityColor } from '../lib/format';
import Skeleton from '../components/Skeleton';
import { DossierNarrative, AnalysisModal } from '../components/shared';

const SEVERITY_LABELS: Record<string, string> = {
  act: 'Critical', watch: 'Warning', notable: 'Notable', info: 'Info',
};

const SNOOZE_OPTIONS = [
  { label: '1d', days: 1 },
  { label: '3d', days: 3 },
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
];

const ENGAGEMENT_ORDER: Record<string, number> = { dark: 0, fading: 1, active: 2 };

function engagementDot(level?: string): { color: string; label: string } {
  switch (level) {
    case 'active': return { color: colors.green, label: 'Active' };
    case 'fading': return { color: colors.yellow, label: 'Fading' };
    case 'dark': return { color: colors.red, label: 'Dark' };
    default: return { color: colors.textMuted, label: 'Unknown' };
  }
}

function linkMethodPill(method?: string): { bg: string; color: string; label: string } | null {
  if (!method) return null;
  switch (method.toLowerCase()) {
    case 'crm': return { bg: `${colors.accent}18`, color: colors.accent, label: 'CRM' };
    case 'email_match': case 'email match': return { bg: `${colors.green}18`, color: colors.green, label: 'Email Match' };
    case 'domain_inferred': case 'domain inferred': return { bg: `${colors.textMuted}18`, color: colors.textMuted, label: 'Domain Inferred' };
    default: return { bg: `${colors.textMuted}18`, color: colors.textMuted, label: method };
  }
}

function gradeColor(grade: string): string {
  switch (grade) {
    case 'A': return colors.green;
    case 'B': return '#38bdf8';
    case 'C': return colors.yellow;
    case 'D': return colors.orange;
    case 'F': return colors.red;
    default: return colors.textMuted;
  }
}

function gradeBg(grade: string): string {
  switch (grade) {
    case 'A': return `${colors.green}20`;
    case 'B': return '#38bdf820';
    case 'C': return `${colors.yellow}20`;
    case 'D': return `${colors.orange}20`;
    case 'F': return `${colors.red}20`;
    default: return `${colors.textMuted}20`;
  }
}

function buildCrmUrl(crm: string | null, portalId: number | null, instanceUrl: string | null, sourceId: string | null, dealSource: string | null): string | null {
  if (!crm || !sourceId) return null;
  if (crm === 'hubspot' && dealSource === 'hubspot' && portalId) {
    return `https://app.hubspot.com/contacts/${portalId}/deal/${sourceId}`;
  }
  if (crm === 'salesforce' && dealSource === 'salesforce' && instanceUrl) {
    const host = instanceUrl.replace(/^https?:\/\//, '');
    return `https://${host}/lightning/r/Opportunity/${sourceId}/view`;
  }
  return null;
}

function ExternalLinkIcon({ size = 12, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export default function DealDetail() {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();
  const [dossier, setDossier] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [snoozingId, setSnoozingId] = useState<string | null>(null);
  const [snoozeDropdownId, setSnoozeDropdownId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [askQuestion, setAskQuestion] = useState('');
  const [askAnswer, setAskAnswer] = useState<any>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState('');
  const [crmInfo, setCrmInfo] = useState<{ crm: string | null; portalId?: number | null; instanceUrl?: string | null }>({ crm: null });
  const [analysisOpen, setAnalysisOpen] = useState(false);

  const fetchDossier = async (withNarrative = false) => {
    if (!dealId) return;
    setLoading(true);
    try {
      const url = withNarrative
        ? `/deals/${dealId}/dossier?narrative=true`
        : `/deals/${dealId}/dossier`;
      const data = await api.get(url);
      setDossier(data);
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDossier();
    api.get('/crm/link-info').then(setCrmInfo).catch(() => {});
  }, [dealId]);

  const dismissFinding = async (findingId: string) => {
    setDismissingId(findingId);
    try {
      await api.patch(`/findings/${findingId}/resolve`, { resolution_method: 'user_dismissed' });
      setDossier((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          findings: (prev.findings || []).filter((f: any) => f.id !== findingId),
        };
      });
    } catch (err: any) {
      if (err.message?.includes('409') || err.message?.includes('already')) {
        setDossier((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            findings: (prev.findings || []).filter((f: any) => f.id !== findingId),
          };
        });
      } else {
        setToast({ message: 'Failed to resolve finding', type: 'error' });
        setTimeout(() => setToast(null), 3000);
      }
    } finally {
      setDismissingId(null);
    }
  };

  const snoozeFinding = async (findingId: string, days: number) => {
    setSnoozingId(findingId);
    setSnoozeDropdownId(null);
    try {
      await api.post(`/findings/${findingId}/snooze`, { days });
      setDossier((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          findings: (prev.findings || []).filter((f: any) => f.id !== findingId),
        };
      });
      setToast({ message: `Finding snoozed for ${days} day${days > 1 ? 's' : ''}`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (err: any) {
      setToast({ message: 'Failed to snooze finding', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSnoozingId(null);
    }
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!askQuestion.trim() || askLoading || !dealId) return;
    setAskLoading(true);
    setAskError('');
    try {
      const result = await api.post('/analyze', {
        question: askQuestion.trim(),
        scope: { type: 'deal', entity_id: dealId },
      });
      setAskAnswer(result);
    } catch (err: any) {
      if (err.message?.includes('429') || err.message?.includes('rate limit')) {
        setAskError('Analysis limit reached. Try again in a few minutes.');
      } else {
        setAskError(err.message || 'Failed to get answer');
      }
    } finally {
      setAskLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton height={80} />
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
          <Skeleton height={300} />
          <Skeleton height={300} />
        </div>
      </div>
    );
  }

  if (error || !dossier) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <p style={{ fontSize: 15, color: colors.textSecondary }}>
          {error || 'Deal not found'}
        </p>
        <button onClick={() => navigate('/')} style={{
          fontSize: 12, color: colors.accent, background: 'none', marginTop: 12,
        }}>
          Back to Command Center
        </button>
      </div>
    );
  }

  const deal = dossier.deal || {};
  const health = dossier.health_signals || {};
  const findingsList = dossier.findings || [];
  const contactsList = [...(dossier.contacts || [])].sort((a: any, b: any) => {
    const aOrder = ENGAGEMENT_ORDER[a.engagement_level] ?? 3;
    const bOrder = ENGAGEMENT_ORDER[b.engagement_level] ?? 3;
    return aOrder - bOrder;
  });
  const activities = dossier.activities || [];
  const conversations = dossier.conversations || [];
  const stageHistory = dossier.stage_history || [];
  const narrative = dossier.narrative;
  const riskScore = dossier.risk_score;
  const coverageGapsData = dossier.coverage_gaps || {};

  const daysInStage = deal.days_in_current_stage ??
    (stageHistory.length > 0 ? Math.round(stageHistory[stageHistory.length - 1]?.days_in_stage || 0) : null);

  const hasCoverageGaps =
    (coverageGapsData.contacts_never_called?.length > 0) ||
    (coverageGapsData.days_since_last_call != null) ||
    (coverageGapsData.unlinked_calls > 0) ||
    (coverageGapsData.total_contacts === 0);

  const healthItems = [
    { label: 'Activity', value: health.activity_recency, color: statusColor(health.activity_recency) },
    { label: 'Threading', value: health.threading, color: statusColor(health.threading) },
    { label: 'Velocity', value: health.stage_velocity, color: statusColor(health.stage_velocity) },
    { label: 'Data', value: health.data_completeness != null ? `${health.data_completeness}%` : null, color: (health.data_completeness || 0) > 60 ? colors.green : colors.yellow },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Breadcrumbs */}
      <nav style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <Link to="/" style={{ color: colors.accent, textDecoration: 'none' }}>Command Center</Link>
        <span style={{ color: colors.textMuted }}>&gt;</span>
        <Link to="/deals" style={{ color: colors.accent, textDecoration: 'none' }}>Deals</Link>
        <span style={{ color: colors.textMuted }}>&gt;</span>
        <span style={{ color: colors.textSecondary }}>{deal.name || 'Deal'}</span>
      </nav>

      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 1000,
          padding: '10px 16px', borderRadius: 8,
          background: toast.type === 'success' ? colors.greenSoft : colors.redSoft,
          border: `1px solid ${toast.type === 'success' ? colors.green : colors.red}`,
          color: toast.type === 'success' ? colors.green : colors.red,
          fontSize: 12, fontWeight: 500,
        }}>
          {toast.message}
        </div>
      )}

      {/* Deal Header */}
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: colors.text }}>
              {deal.name || 'Unnamed Deal'}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
              <span style={{ fontSize: 24, fontWeight: 700, fontFamily: fonts.mono, color: colors.text }}>
                {formatCurrency(Number(deal.amount) || 0)}
              </span>
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: 6,
                background: colors.accentSoft,
                color: colors.accent,
                textTransform: 'capitalize',
              }}>
                {deal.stage_normalized?.replace(/_/g, ' ') || deal.stage || 'Unknown'}
              </span>
              {daysInStage != null && (
                <span style={{
                  fontSize: 11, fontWeight: 500, fontFamily: fonts.mono,
                  color: colors.textMuted,
                }}>
                  {daysInStage}d in stage
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: colors.textMuted }}>
              <span>Owner: {deal.owner_name || deal.owner_email || deal.owner || '--'}</span>
              <span>Close: {deal.close_date ? formatDate(deal.close_date) : '--'}</span>
              {deal.account_name && (
                <span
                  style={{ color: colors.accent, cursor: 'pointer' }}
                  onClick={() => deal.account_id && navigate(`/accounts/${deal.account_id}`)}
                >
                  {deal.account_name}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setAnalysisOpen(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 11, fontWeight: 500, padding: '6px 12px',
                borderRadius: 6, border: `1px solid ${colors.accent}30`,
                background: colors.accentSoft, color: colors.accent,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${colors.accent}25`; }}
              onMouseLeave={e => { e.currentTarget.style.background = colors.accentSoft; }}
            >
              Ask about this deal
            </button>

            {(() => {
              const crmUrl = buildCrmUrl(crmInfo.crm, crmInfo.portalId ?? null, crmInfo.instanceUrl ?? null, deal.source_id, deal.source);
              if (!crmUrl) return null;
              const label = crmInfo.crm === 'hubspot' ? 'Open in HubSpot' : 'Open in Salesforce';
              return (
                <a
                  href={crmUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 11, fontWeight: 500, padding: '6px 12px',
                    borderRadius: 6, textDecoration: 'none',
                    background: colors.accentSoft, color: colors.accent,
                    border: `1px solid ${colors.accent}30`,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${colors.accent}25`; }}
                  onMouseLeave={e => { e.currentTarget.style.background = colors.accentSoft; }}
                >
                  {label}
                  <ExternalLinkIcon size={11} color={colors.accent} />
                </a>
              );
            })()}

            {riskScore && riskScore.grade && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 14px', borderRadius: 8,
                background: gradeBg(riskScore.grade),
                border: `1px solid ${gradeColor(riskScore.grade)}30`,
              }}>
                <span style={{
                  fontSize: 20, fontWeight: 700,
                  color: gradeColor(riskScore.grade),
                  fontFamily: fonts.mono,
                }}>
                  {riskScore.grade}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase' }}>
                    Health
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, fontFamily: fonts.mono, color: colors.text }}>
                    {riskScore.score}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Health Signals */}
        <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
          {healthItems.map((h, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: h.color,
                boxShadow: `0 0 6px ${h.color}40`,
              }} />
              <span style={{ fontSize: 11, color: colors.textMuted }}>{h.label}:</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: colors.textSecondary, textTransform: 'capitalize' }}>
                {h.value || 'N/A'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* AI Narrative */}
      {dealId && (
        <DossierNarrative
          narrative={narrative}
          onGenerate={() => fetchDossier(true)}
        />
      )}

      {/* Coverage Gaps */}
      {hasCoverageGaps && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderLeft: `3px solid ${colors.yellow}`,
          borderRadius: 10,
          padding: 16,
        }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
            Coverage Gaps
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {coverageGapsData.total_contacts === 0 && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ color: colors.yellow, fontSize: 14, marginTop: 1, flexShrink: 0 }}>&#9888;</span>
                <p style={{ fontSize: 13, color: colors.text, lineHeight: 1.4 }}>No contacts linked to this deal</p>
              </div>
            )}

            {coverageGapsData.days_since_last_call != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ color: colors.yellow, fontSize: 14, flexShrink: 0 }}>&#9888;</span>
                <span style={{ fontSize: 13, color: colors.text }}>Days Since Last Call</span>
                <span style={{
                  fontSize: 18, fontWeight: 700, fontFamily: fonts.mono,
                  color: coverageGapsData.days_since_last_call > 14 ? colors.red : colors.yellow,
                }}>
                  {coverageGapsData.days_since_last_call}
                </span>
              </div>
            )}

            {coverageGapsData.contacts_never_called?.length > 0 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  <span style={{ color: colors.yellow, fontSize: 14, marginTop: 1, flexShrink: 0 }}>&#9888;</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>
                    {coverageGapsData.contacts_never_called.length} Contact{coverageGapsData.contacts_never_called.length > 1 ? 's' : ''} Never Called
                  </span>
                </div>
                <div style={{ paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {coverageGapsData.contacts_never_called.map((c: any, i: number) => (
                    <div key={i} style={{ fontSize: 12, color: colors.textSecondary }}>
                      {c.name || c.email || 'Unknown'}
                      {c.title && <span style={{ color: colors.textMuted }}> — {c.title}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {coverageGapsData.unlinked_calls > 0 && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ color: colors.yellow, fontSize: 14, marginTop: 1, flexShrink: 0 }}>&#9888;</span>
                <p style={{ fontSize: 13, color: colors.text, lineHeight: 1.4 }}>
                  {coverageGapsData.unlinked_calls} call{coverageGapsData.unlinked_calls > 1 ? 's' : ''} match this account's domain but aren't linked to this deal
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Two Column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Active Findings */}
          <Card title="Active Findings" count={findingsList.length}>
            {findingsList.length === 0 ? (
              <EmptyText>No active findings for this deal</EmptyText>
            ) : (
              findingsList.map((f: any, i: number) => {
                const isProcessing = dismissingId === f.id || snoozingId === f.id;
                return (
                  <div key={f.id || i} style={{
                    display: 'flex', gap: 8, padding: '8px 0',
                    borderBottom: `1px solid ${colors.border}`,
                    opacity: isProcessing ? 0.4 : 1,
                    transition: 'opacity 0.3s',
                  }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: severityColor(f.severity), marginTop: 5, flexShrink: 0,
                      boxShadow: `0 0 6px ${severityColor(f.severity)}40`,
                    }} />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 13, color: colors.text }}>{f.message}</p>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                          background: `${severityColor(f.severity)}15`,
                          color: severityColor(f.severity),
                          textTransform: 'capitalize',
                        }}>
                          {SEVERITY_LABELS[f.severity] || f.severity}
                        </span>
                        <span style={{ fontSize: 11, color: colors.textMuted }}>
                          {f.skill_id} · {formatTimeAgo(f.found_at)}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignSelf: 'center', flexShrink: 0, position: 'relative' }}>
                      <button
                        onClick={() => setSnoozeDropdownId(snoozeDropdownId === f.id ? null : f.id)}
                        disabled={isProcessing}
                        style={{
                          fontSize: 11, fontWeight: 500, padding: '4px 10px',
                          borderRadius: 4, border: `1px solid ${colors.border}`,
                          background: 'transparent', color: colors.textMuted,
                          cursor: isProcessing ? 'not-allowed' : 'pointer',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { if (!isProcessing) { e.currentTarget.style.borderColor = colors.yellow; e.currentTarget.style.color = colors.yellow; } }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.color = colors.textMuted; }}
                      >
                        Snooze
                      </button>
                      {snoozeDropdownId === f.id && (
                        <div style={{
                          position: 'absolute', top: '100%', right: 0, marginTop: 4,
                          background: colors.surfaceRaised, border: `1px solid ${colors.border}`,
                          borderRadius: 6, padding: 4, zIndex: 100,
                          display: 'flex', flexDirection: 'column', gap: 2,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                          minWidth: 80,
                        }}>
                          {SNOOZE_OPTIONS.map(opt => (
                            <button
                              key={opt.days}
                              onClick={() => snoozeFinding(f.id, opt.days)}
                              style={{
                                fontSize: 11, padding: '4px 8px', borderRadius: 4,
                                background: 'transparent', border: 'none',
                                color: colors.textSecondary, cursor: 'pointer',
                                textAlign: 'left', transition: 'all 0.1s',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; e.currentTarget.style.color = colors.yellow; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.textSecondary; }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                      <button
                        onClick={() => dismissFinding(f.id)}
                        disabled={isProcessing}
                        style={{
                          fontSize: 11, fontWeight: 500, padding: '4px 10px',
                          borderRadius: 4, border: `1px solid ${colors.border}`,
                          background: 'transparent', color: colors.textMuted,
                          cursor: isProcessing ? 'not-allowed' : 'pointer',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { if (!isProcessing) { e.currentTarget.style.borderColor = colors.red; e.currentTarget.style.color = colors.red; } }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.color = colors.textMuted; }}
                      >
                        {dismissingId === f.id ? '...' : 'Dismiss'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </Card>

          {/* Stage History */}
          <Card title="Stage History">
            {stageHistory.length === 0 ? (
              <EmptyText>Stage history not available</EmptyText>
            ) : (
              <div style={{ paddingLeft: 12 }}>
                {stageHistory.map((s: any, i: number) => (
                  <div key={i} style={{
                    display: 'flex', gap: 12, paddingBottom: 12, position: 'relative',
                    borderLeft: i < stageHistory.length - 1 ? `2px solid ${colors.border}` : `2px solid ${colors.accent}`,
                    paddingLeft: 16,
                  }}>
                    <div style={{
                      position: 'absolute', left: -5, top: 0,
                      width: 8, height: 8, borderRadius: '50%',
                      background: i === stageHistory.length - 1 ? colors.accent : colors.border,
                    }} />
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: colors.text, textTransform: 'capitalize' }}>
                        {s.stage_label || s.stage_normalized?.replace(/_/g, ' ') || s.stage?.replace(/_/g, ' ') || 'Unknown'}
                      </span>
                      <div style={{ fontSize: 11, color: colors.textMuted }}>
                        {s.entered_at ? formatDate(s.entered_at) : ''} {s.days_in_stage ? `· ${Math.round(s.days_in_stage)}d` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Activity Timeline */}
          <Card title="Recent Activity" count={activities.length}>
            {activities.length === 0 ? (
              <EmptyText>No activity records</EmptyText>
            ) : (
              activities.slice(0, 20).map((a: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: `1px solid ${colors.border}` }}>
                  <span style={{ fontSize: 12, width: 24, textAlign: 'center', flexShrink: 0 }}>
                    {activityIcon(a.type)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, color: colors.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.subject || a.type || 'Activity'}
                    </p>
                    <span style={{ fontSize: 11, color: colors.textMuted }}>
                      {a.actor || ''} · {a.timestamp ? formatTimeAgo(a.timestamp) : ''}
                    </span>
                  </div>
                </div>
              ))
            )}
          </Card>

          {/* Conversations */}
          <Card title="Conversations" count={conversations.length}>
            {conversations.length === 0 ? (
              <EmptyText>No linked conversations</EmptyText>
            ) : (
              conversations.map((c: any, i: number) => {
                const lm = linkMethodPill(c.link_method);
                return (
                  <div key={i} style={{ padding: '8px 0', borderBottom: `1px solid ${colors.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: colors.text, flex: 1 }}>
                        {c.title || 'Untitled conversation'}
                      </p>
                      {lm && (
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                          background: lm.bg, color: lm.color,
                        }}>
                          {lm.label}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                      {c.date ? formatDate(c.date) : ''}
                      {c.duration_minutes ? ` · ${c.duration_minutes}m` : ''}
                      {c.participant_count ? ` · ${c.participant_count} participants` : ''}
                    </div>
                    {c.summary && (
                      <p style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 1.4 }}>
                        {c.summary.slice(0, 200)}{c.summary.length > 200 ? '...' : ''}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </Card>
        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Contacts */}
          <Card title="Contacts" count={contactsList.length}>
            {contactsList.length === 0 ? (
              <EmptyText>No contacts linked — this deal is single-threaded</EmptyText>
            ) : (
              contactsList.map((c: any, i: number) => {
                const eng = engagementDot(c.engagement_level);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${colors.border}` }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%',
                      background: colors.surfaceHover,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 600, color: colors.textSecondary, flexShrink: 0,
                    }}>
                      {(c.name || c.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: colors.text }}>
                        {c.name || c.email || 'Unknown'}
                      </span>
                      {c.title && <span style={{ fontSize: 11, color: colors.textMuted, display: 'block' }}>{c.title}</span>}
                      {c.last_activity_date && (
                        <span style={{ fontSize: 10, color: colors.textDim, display: 'block' }}>
                          Last active {formatTimeAgo(c.last_activity_date)}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: eng.color,
                          boxShadow: `0 0 4px ${eng.color}40`,
                        }} />
                        <span style={{ fontSize: 10, color: eng.color }}>{eng.label}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {c.role && (
                          <span
                            title={c.role_confidence ? `Confidence: ${c.role_confidence}` : undefined}
                            style={{
                              fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                              background: colors.accentSoft, color: colors.accent, textTransform: 'capitalize',
                            }}
                          >
                            {c.role}
                          </span>
                        )}
                        {c.buying_role && c.buying_role !== c.role && (
                          <span style={{
                            fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                            background: `${colors.purple}15`, color: colors.purple, textTransform: 'capitalize',
                          }}>
                            {c.buying_role}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </Card>

          {/* Deal Details */}
          <Card title="Deal Details">
            <DetailRow label="Source" value={deal.source} />
            <DetailRow label="Pipeline" value={deal.pipeline_name || deal.pipeline} />
            <DetailRow label="Probability" value={deal.probability ? `${deal.probability}%` : undefined} />
            <DetailRow label="Forecast" value={deal.forecast_category} />
            <DetailRow label="Created" value={deal.created_at ? formatDate(deal.created_at) : undefined} />
            <DetailRow label="Close Date" value={deal.close_date ? formatDate(deal.close_date) : undefined} />
            <DetailRow label="Last Modified" value={deal.updated_at ? formatDate(deal.updated_at) : undefined} />
          </Card>

          {/* Ask Pandora */}
          {dealId && (
            <div style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              padding: 20,
            }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
                Ask Pandora
              </h3>
              <form onSubmit={handleAsk} style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={askQuestion}
                  onChange={e => setAskQuestion(e.target.value)}
                  placeholder="Ask about this deal... e.g. 'What are the biggest risks?'"
                  disabled={askLoading}
                  style={{
                    flex: 1, fontSize: 13, padding: '8px 12px',
                    background: colors.surfaceRaised,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6, color: colors.text, outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  disabled={askLoading || !askQuestion.trim()}
                  style={{
                    fontSize: 12, fontWeight: 500, padding: '8px 16px',
                    background: askLoading || !askQuestion.trim() ? colors.surfaceRaised : colors.accentSoft,
                    color: askLoading || !askQuestion.trim() ? colors.textMuted : colors.accent,
                    border: 'none', borderRadius: 6,
                    cursor: askLoading || !askQuestion.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {askLoading ? 'Analyzing...' : 'Ask'}
                </button>
              </form>

              {askError && (
                <div style={{
                  marginTop: 12, padding: 12, background: colors.redSoft,
                  border: `1px solid ${colors.red}33`, borderRadius: 6,
                  color: colors.red, fontSize: 12,
                }}>
                  {askError}
                </div>
              )}

              {askAnswer && (
                <div style={{
                  marginTop: 12, padding: 16,
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.borderLight}`,
                  borderRadius: 6,
                }}>
                  <p style={{ fontSize: 13, lineHeight: 1.6, color: colors.text, margin: 0, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
                    {askAnswer.answer}
                  </p>
                  <div style={{ display: 'flex', gap: 16, fontSize: 11, color: colors.textMuted, fontFamily: fonts.mono }}>
                    {askAnswer.data_consulted && (
                      <span>Data: {Object.values(askAnswer.data_consulted).filter((v: any) => typeof v === 'number' && v > 0).length} sources</span>
                    )}
                    {askAnswer.tokens_used && <span>{askAnswer.tokens_used} tokens</span>}
                    {askAnswer.latency_ms && <span>{(askAnswer.latency_ms / 1000).toFixed(1)}s</span>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {dealId && (
        <AnalysisModal
          scope={{ type: 'deal', entity_id: dealId }}
          visible={analysisOpen}
          onClose={() => setAnalysisOpen(false)}
        />
      )}
    </div>
  );
}

function Card({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{title}</h3>
        {count !== undefined && (
          <span style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.textMuted }}>{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${colors.border}` }}>
      <span style={{ fontSize: 12, color: colors.textMuted }}>{label}</span>
      <span style={{ fontSize: 12, color: colors.text, textTransform: 'capitalize' }}>{value}</span>
    </div>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12, color: colors.textMuted, padding: '8px 0' }}>{children}</p>;
}

function statusColor(status?: string): string {
  if (!status) return colors.textMuted;
  switch (status.toLowerCase()) {
    case 'active': case 'fast': case 'multi': return colors.green;
    case 'cooling': case 'normal': case 'dual': return colors.yellow;
    case 'stale': case 'slow': case 'single': return colors.red;
    default: return colors.textMuted;
  }
}

function activityIcon(type?: string): string {
  switch (type?.toLowerCase()) {
    case 'email': return '\u2709';
    case 'call': return '\u260E';
    case 'meeting': return '\u{1F4C5}';
    case 'task': return '\u2713';
    default: return '\u2022';
  }
}
