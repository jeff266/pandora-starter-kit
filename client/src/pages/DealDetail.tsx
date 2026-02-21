import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatDate, formatTimeAgo, severityColor } from '../lib/format';
import Skeleton from '../components/Skeleton';
import SectionErrorBoundary from '../components/SectionErrorBoundary';
import { DossierNarrative, AnalysisModal } from '../components/shared';
import { useDemoMode } from '../contexts/DemoModeContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { buildDealCrmUrl, buildConversationUrl, useCrmInfo } from '../lib/deeplinks';

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
const ROLE_PRIORITY: Record<string, number> = {
  executive_sponsor: 1,
  decision_maker: 2,
  influencer: 3,
  champion: 4,
  economic_buyer: 5,
};

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


interface ActiveScore {
  score: number;
  grade: string;
  source: 'skill' | 'health';
}

interface MechanicalScore {
  score: number | null;
  grade: string;
}

export default function DealDetail() {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();
  const { anon } = useDemoMode();
  const isMobile = useIsMobile();
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
  const { crmInfo } = useCrmInfo();
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
  const [scoreHistory, setScoreHistory] = useState<any[]>([]);

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
    if (dealId) {
      api.get(`/deals/${dealId}/score-history`).then((res: any) => {
        setScoreHistory(res.snapshots || []);
      }).catch(() => {});
    }
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
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 16 }}>
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
    // Sort by buying role first (Executive Sponsor > Decision Maker > Influencer)
    const aRole = a.buying_role ? a.buying_role.toLowerCase().replace(/ /g, '_') : '';
    const bRole = b.buying_role ? b.buying_role.toLowerCase().replace(/ /g, '_') : '';
    const aRolePriority = ROLE_PRIORITY[aRole] ?? 999;
    const bRolePriority = ROLE_PRIORITY[bRole] ?? 999;
    if (aRolePriority !== bRolePriority) {
      return aRolePriority - bRolePriority;
    }
    // Then by engagement level
    const aEngagement = ENGAGEMENT_ORDER[a.engagement_level] ?? 3;
    const bEngagement = ENGAGEMENT_ORDER[b.engagement_level] ?? 3;
    return bEngagement - aEngagement; // Active first
  });
  const activities = dossier.activities || [];
  const conversations = dossier.conversations || [];
  const stageHistory = dossier.stage_history || [];
  const narrative = dossier.narrative;
  const riskScore = dossier.risk_score;
  const activeScore: ActiveScore | undefined = dossier.active_score;
  const mechanicalScore: MechanicalScore | null = dossier.mechanical_score ?? null;
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
        <span style={{ color: colors.textSecondary }}>{anon.deal(deal.name || 'Deal')}</span>
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
      <SectionErrorBoundary fallbackMessage="Unable to load deal header.">
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 20,
      }}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'flex-start', gap: isMobile ? 12 : 0 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: colors.text }}>
              {anon.deal(deal.name || 'Unnamed Deal')}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
              <span style={{ fontSize: 24, fontWeight: 700, fontFamily: fonts.mono, color: colors.text }}>
                {formatCurrency(anon.amount(Number(deal.amount) || 0))}
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 8 : 16, marginTop: 8, fontSize: 12, color: colors.textMuted }}>
              <span>Owner: {deal.owner_name ? anon.person(deal.owner_name) : deal.owner_email ? anon.email(deal.owner_email) : deal.owner ? anon.person(deal.owner) : '--'}</span>
              <span>Close: {deal.close_date ? formatDate(deal.close_date) : '--'}</span>
              {deal.account_name && (
                <span
                  style={{ color: colors.accent, cursor: 'pointer' }}
                  onClick={() => deal.account_id && navigate(`/accounts/${deal.account_id}`)}
                >
                  {anon.company(deal.account_name)}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
              const crmUrl = buildDealCrmUrl(crmInfo.crm, crmInfo.portalId ?? null, crmInfo.instanceUrl ?? null, deal.source_id, deal.source);
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
                  <ExternalLink size={11} color={colors.accent} />
                </a>
              );
            })()}

            {(activeScore || (riskScore && riskScore.grade)) && (() => {
              const displayGrade = activeScore ? activeScore.grade : riskScore.grade;
              const displayScore = activeScore ? activeScore.score : riskScore.score;
              const displaySource = activeScore ? activeScore.source : 'health';
              return (
                <div style={{ position: 'relative' }}>
                  <div
                    onClick={() => setShowScoreBreakdown(v => !v)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 14px', borderRadius: 8,
                      background: gradeBg(displayGrade),
                      border: `1px solid ${gradeColor(displayGrade)}30`,
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    <span style={{
                      fontSize: 20, fontWeight: 700,
                      color: gradeColor(displayGrade),
                      fontFamily: fonts.mono,
                    }}>
                      {displayGrade}
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase' }}>
                        Score
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 600, fontFamily: fonts.mono, color: colors.text }}>
                        {displayScore}
                      </span>
                      <span style={{ fontSize: 9, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {displaySource === 'skill' ? 'SKILL' : 'HEALTH'}
                      </span>
                    </div>
                  </div>
                  {showScoreBreakdown && riskScore && activeScore && (
                    <ScoreBreakdownPanel
                      riskScore={riskScore}
                      mechanicalScore={mechanicalScore}
                      activeScore={activeScore}
                      onClose={() => setShowScoreBreakdown(false)}
                    />
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Health Signals */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 10 : 16, marginTop: 16 }}>
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
      </SectionErrorBoundary>

      {/* AI Narrative */}
      <SectionErrorBoundary fallbackMessage="Unable to load AI narrative.">
      {dealId && (
        <DossierNarrative
          narrative={narrative}
          onGenerate={() => fetchDossier(true)}
        />
      )}
      </SectionErrorBoundary>

      {/* Coverage Gaps */}
      <SectionErrorBoundary fallbackMessage="Unable to load coverage gaps.">
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
                      {c.name ? anon.person(c.name) : c.email ? anon.email(c.email) : 'Unknown'}
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
      </SectionErrorBoundary>

      {/* Two Column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.8fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Active Findings */}
          <SectionErrorBoundary fallbackMessage="Something went wrong loading findings.">
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
                      <p style={{ fontSize: 13, color: colors.text }}>{anon.text(f.message)}</p>
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
          </SectionErrorBoundary>

          {/* Stage History */}
          <SectionErrorBoundary fallbackMessage="Unable to load stage history.">
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
          </SectionErrorBoundary>

          {/* Activity Timeline */}
          <SectionErrorBoundary fallbackMessage="Unable to load recent activity.">
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
                      {anon.text(a.subject || a.type || 'Activity')}
                    </p>
                    <span style={{ fontSize: 11, color: colors.textMuted }}>
                      {a.actor ? anon.person(a.actor) : ''} · {a.timestamp ? formatTimeAgo(a.timestamp) : ''}
                    </span>
                  </div>
                </div>
              ))
            )}
          </Card>
          </SectionErrorBoundary>

          {/* Conversations */}
          <SectionErrorBoundary fallbackMessage="Unable to load conversations.">
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
                        {anon.text(c.title || 'Untitled conversation')}
                      </p>
                      {lm && (
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                          background: lm.bg, color: lm.color,
                        }}>
                          {lm.label}
                        </span>
                      )}
                      {(() => {
                        const conversationUrl = buildConversationUrl(
                          c.source,
                          c.source_id,
                          c.source_data,
                          c.custom_fields
                        );
                        return conversationUrl ? (
                          <a
                            href={conversationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Open in ${c.source}`}
                            style={{ color: colors.accent, lineHeight: 0, marginLeft: 8 }}
                          >
                            <ExternalLink size={14} />
                          </a>
                        ) : null;
                      })()}
                    </div>
                    <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                      {c.date ? formatDate(c.date) : ''}
                      {c.duration_minutes ? ` · ${c.duration_minutes}m` : ''}
                      {c.participant_count ? ` · ${c.participant_count} participants` : ''}
                    </div>
                    {c.summary && (
                      <p style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 1.4 }}>
                        {anon.text(c.summary.slice(0, 200))}{c.summary.length > 200 ? '...' : ''}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </Card>
          </SectionErrorBoundary>
        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Contacts */}
          <SectionErrorBoundary fallbackMessage="Unable to load deal contacts.">
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
                      {(c.name ? anon.person(c.name) : c.email ? anon.email(c.email) : '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: colors.text }}>
                        {c.name ? anon.person(c.name) : c.email ? anon.email(c.email) : 'Unknown'}
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
          </SectionErrorBoundary>

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
                    {anon.text(askAnswer.answer)}
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

      {/* Score History */}
      <SectionErrorBoundary fallbackMessage="Unable to load score history.">
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 16,
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 12 }}>Score History</h3>
        {scoreHistory.length === 0 ? (
          <p style={{ fontSize: 12, color: colors.textMuted, padding: '8px 0' }}>
            No score history yet — history builds weekly.
          </p>
        ) : (
          <div style={{ overflowX: 'auto', maxWidth: '100%', WebkitOverflowScrolling: 'touch' as any }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: isMobile ? 500 : undefined }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                  {['Week', 'Score', 'Grade', 'Change', 'Notes'].map(h => (
                    <th key={h} style={{
                      padding: '6px 10px', textAlign: 'left',
                      fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                      letterSpacing: '0.05em', color: colors.textMuted,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scoreHistory.slice(0, 8).map((s: any, i: number) => {
                  const delta = s.score_delta;
                  const deltaEl = delta == null ? (
                    <span style={{ color: colors.textMuted }}>—</span>
                  ) : delta > 0 ? (
                    <span style={{ color: colors.green }}>\u2191{delta}</span>
                  ) : delta < 0 ? (
                    <span style={{ color: colors.red }}>\u2193{Math.abs(delta)}</span>
                  ) : (
                    <span style={{ color: colors.textMuted }}>—</span>
                  );

                  const weekLabel = s.snapshot_date
                    ? new Date(s.snapshot_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : '—';

                  const commentary = s.commentary
                    ? s.commentary.length > 100
                      ? s.commentary.slice(0, 100) + '...'
                      : s.commentary
                    : '';

                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={{ padding: '8px 10px', color: colors.textSecondary, fontFamily: fonts.mono, fontSize: 11 }}>
                        {weekLabel}
                      </td>
                      <td style={{ padding: '8px 10px', color: colors.text, fontFamily: fonts.mono, fontWeight: 600 }}>
                        {s.active_score ?? s.health_score ?? '—'}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, fontFamily: fonts.mono,
                          padding: '1px 6px', borderRadius: 4,
                          background: `${gradeColor(s.grade || '—')}20`,
                          color: gradeColor(s.grade || '—'),
                        }}>
                          {s.grade || '—'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', fontFamily: fonts.mono, fontWeight: 600 }}>
                        {deltaEl}
                      </td>
                      <td style={{ padding: '8px 10px', color: colors.textMuted, fontStyle: 'italic', maxWidth: isMobile ? '100%' : 320 }}>
                        {commentary}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </SectionErrorBoundary>

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

function ScoreBreakdownPanel({
  riskScore,
  mechanicalScore,
  activeScore,
  onClose,
}: {
  riskScore: { score: number; grade: string; signal_counts: { act: number; watch: number; notable: number; info: number } };
  mechanicalScore: { score: number | null; grade: string } | null;
  activeScore: { score: number; grade: string; source: 'skill' | 'health' };
  onClose: () => void;
}) {
  const isSkill = activeScore.source === 'skill';
  const sc = riskScore.signal_counts;
  const allZero = sc.act === 0 && sc.watch === 0 && sc.notable === 0 && sc.info === 0;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 99,
        }}
      />
      {/* Panel */}
      <div style={{
        position: 'absolute', top: 60, right: 0, zIndex: 100,
        background: colors.surface, border: `1px solid ${colors.border}`,
        borderRadius: 10, padding: 20, width: 280, fontSize: 13,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
          Score Breakdown
        </div>
        <div style={{ height: 1, background: colors.border, marginBottom: 12 }} />

        {/* Two columns: Skill-based vs Health */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Skill-based
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: fonts.mono, color: gradeColor(riskScore.grade) }}>
              {riskScore.score}
            </div>
            <div style={{ fontSize: 11, color: gradeColor(riskScore.grade), fontWeight: 600 }}>
              {riskScore.grade}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Health
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: fonts.mono, color: mechanicalScore ? gradeColor(mechanicalScore.grade) : colors.textMuted }}>
              {mechanicalScore?.score ?? '—'}
            </div>
            <div style={{ fontSize: 11, color: mechanicalScore ? gradeColor(mechanicalScore.grade) : colors.textMuted, fontWeight: 600 }}>
              {mechanicalScore?.grade ?? '—'}
            </div>
          </div>
        </div>

        <div style={{
          fontSize: 11, color: colors.textMuted, textAlign: 'center',
          padding: '6px 10px', background: colors.surfaceRaised, borderRadius: 6, marginBottom: 12,
        }}>
          Showing: <span style={{ fontWeight: 600, color: isSkill ? '#6488ea' : colors.accent }}>
            {isSkill ? 'SKILL' : 'HEALTH'}
          </span> score (lower of two)
        </div>

        <div style={{ height: 1, background: colors.border, marginBottom: 10 }} />
        <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          Active score drivers
        </div>

        {isSkill ? (
          allZero ? (
            <p style={{ fontSize: 12, color: colors.textMuted }}>
              No active findings — score based on historical baseline
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {sc.act > 0 && (
                <div style={{ fontSize: 12, color: colors.red }}>
                  • {sc.act} critical finding{sc.act !== 1 ? 's' : ''}
                </div>
              )}
              {sc.watch > 0 && (
                <div style={{ fontSize: 12, color: colors.yellow }}>
                  • {sc.watch} watch finding{sc.watch !== 1 ? 's' : ''}
                </div>
              )}
              {sc.notable > 0 && (
                <div style={{ fontSize: 12, color: colors.textSecondary }}>
                  • {sc.notable} notable
                </div>
              )}
              {sc.info > 0 && (
                <div style={{ fontSize: 12, color: colors.textMuted }}>
                  • {sc.info} informational
                </div>
              )}
            </div>
          )
        ) : (
          <p style={{ fontSize: 12, color: colors.textMuted }}>
            No skill findings yet — using activity-based health score
          </p>
        )}
      </div>
    </>
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
