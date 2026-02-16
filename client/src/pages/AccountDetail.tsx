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

function healthBadgeColor(status?: string): { bg: string; color: string; label: string } {
  switch (status) {
    case 'healthy': return { bg: `${colors.green}18`, color: colors.green, label: 'Healthy' };
    case 'at_risk': return { bg: `${colors.yellow}18`, color: colors.yellow, label: 'At Risk' };
    case 'declining': return { bg: `${colors.orange}18`, color: colors.orange, label: 'Declining' };
    case 'cold': return { bg: `${colors.red}18`, color: colors.red, label: 'Cold' };
    default: return { bg: `${colors.textMuted}18`, color: colors.textMuted, label: status || 'Unknown' };
  }
}

function trendArrow(trend?: string): string {
  switch (trend) {
    case 'increasing': return '↑';
    case 'stable': return '→';
    case 'decreasing': return '↓';
    default: return '→';
  }
}

function trendColor(trend?: string): string {
  switch (trend) {
    case 'increasing': return colors.green;
    case 'decreasing': return colors.red;
    default: return colors.textMuted;
  }
}

function buildAccountCrmUrl(crm: string | null, portalId: number | null, instanceUrl: string | null, sourceId: string | null, accountSource: string | null): string | null {
  if (!crm || !sourceId) return null;
  if (crm === 'hubspot' && accountSource === 'hubspot' && portalId) {
    return `https://app.hubspot.com/contacts/${portalId}/company/${sourceId}`;
  }
  if (crm === 'salesforce' && accountSource === 'salesforce' && instanceUrl) {
    const host = instanceUrl.replace(/^https?:\/\//, '');
    return `https://${host}/lightning/r/Account/${sourceId}/view`;
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

export default function AccountDetail() {
  const { accountId } = useParams<{ accountId: string }>();
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
    if (!accountId) return;
    setLoading(true);
    try {
      const url = withNarrative
        ? `/accounts/${accountId}/dossier?narrative=true`
        : `/accounts/${accountId}/dossier`;
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
  }, [accountId]);

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
    if (!askQuestion.trim() || askLoading || !accountId) return;
    setAskLoading(true);
    setAskError('');
    try {
      const result = await api.post('/analyze', {
        question: askQuestion.trim(),
        scope: { type: 'account', entity_id: accountId },
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
        <p style={{ fontSize: 15, color: colors.textSecondary }}>{error || 'Account not found'}</p>
        <button onClick={() => navigate('/')} style={{ fontSize: 12, color: colors.accent, background: 'none', marginTop: 12 }}>
          Back to Command Center
        </button>
      </div>
    );
  }

  const account = dossier.account || {};
  const deals = dossier.deals || [];
  const contacts = dossier.contacts || [];
  const conversations = dossier.conversations || [];
  const activities = dossier.activities || [];
  const findings = dossier.findings || [];
  const rel = dossier.relationship_summary || {};
  const narrative = dossier.narrative;
  const relHealth = dossier.relationship_health || {};

  const openDeals = [...deals.filter((d: any) => !['closed_won', 'closed_lost'].includes(d.stage_normalized))].sort((a: any, b: any) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
  const closedDeals = [...deals.filter((d: any) => ['closed_won', 'closed_lost'].includes(d.stage_normalized))].sort((a: any, b: any) => (Number(b.amount) || 0) - (Number(a.amount) || 0));

  const sortedContacts = [...contacts].sort((a: any, b: any) => (Number(a.conversation_count) || 0) - (Number(b.conversation_count) || 0));

  const findingsByDeal: Record<string, any[]> = {};
  findings.forEach((f: any) => {
    const key = f.deal_name || f.deal_id || 'Account-Level';
    if (!findingsByDeal[key]) findingsByDeal[key] = [];
    findingsByDeal[key].push(f);
  });

  const healthStatus = relHealth.overall || relHealth.status;
  const badge = healthBadgeColor(healthStatus);

  const crmUrl = buildAccountCrmUrl(crmInfo.crm, crmInfo.portalId ?? null, crmInfo.instanceUrl ?? null, account.source_id, account.source);
  const crmLabel = crmInfo.crm === 'hubspot' ? 'Open in HubSpot' : crmInfo.crm === 'salesforce' ? 'Open in Salesforce' : 'Open in CRM';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <nav style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <Link to="/" style={{ color: colors.accent, textDecoration: 'none' }}>Command Center</Link>
        <span style={{ color: colors.textMuted }}>&gt;</span>
        <Link to="/accounts" style={{ color: colors.accent, textDecoration: 'none' }}>Accounts</Link>
        <span style={{ color: colors.textMuted }}>&gt;</span>
        <span style={{ color: colors.textSecondary }}>{account.name || 'Account'}</span>
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

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: colors.text }}>
                {account.name || 'Unnamed Account'}
              </h2>
              {account.industry && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                  background: `${colors.purple}18`, color: colors.purple,
                  textTransform: 'capitalize',
                }}>
                  {account.industry}
                </span>
              )}
              {healthStatus && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                  background: badge.bg, color: badge.color,
                  textTransform: 'capitalize',
                }}>
                  {badge.label}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 12, color: colors.textMuted }}>
              {account.domain && <span>{account.domain}</span>}
              {account.employee_count && <span>{account.employee_count} employees</span>}
              {account.annual_revenue && <span>Rev: {formatCurrency(Number(account.annual_revenue))}</span>}
              {(account.owner_email || account.owner) && <span>Owner: {account.owner_email || account.owner}</span>}
            </div>
            <div style={{ display: 'flex', gap: 20, marginTop: 12 }}>
              <MiniStat label="Total Deals" value={String(rel.total_deals || deals.length)} />
              <MiniStat label="Open Value" value={formatCurrency(Number(rel.open_value) || 0)} />
              <MiniStat label="Won Value" value={formatCurrency(Number(rel.won_value) || 0)} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
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
              Ask about this account
            </button>

            {crmUrl && (
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
                {crmLabel}
                <ExternalLinkIcon size={11} color={colors.accent} />
              </a>
            )}
          </div>
        </div>
      </div>

      {accountId && (
        <DossierNarrative
          narrative={narrative}
          onGenerate={() => fetchDossier(true)}
        />
      )}

      {relHealth && Object.keys(relHealth).length > 0 && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderLeft: `3px solid ${badge.color}`,
          borderRadius: 10,
          padding: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>
              Relationship Health
            </h3>
            {relHealth.engagement_trend && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 18, color: trendColor(relHealth.engagement_trend) }}>
                  {trendArrow(relHealth.engagement_trend)}
                </span>
                <span style={{ fontSize: 11, color: trendColor(relHealth.engagement_trend), fontWeight: 500, textTransform: 'capitalize' }}>
                  {relHealth.engagement_trend}
                </span>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
            {healthStatus && (
              <HealthMetric
                label="Overall"
                value={healthStatus}
                color={badge.color}
              />
            )}
            {relHealth.conversations_last_30d != null && (
              <HealthMetric
                label="Conversations (30d)"
                value={String(relHealth.conversations_last_30d)}
                color={relHealth.conversations_last_30d > 0 ? colors.green : colors.red}
              />
            )}
            {relHealth.conversations_last_90d != null && (
              <HealthMetric
                label="Conversations (90d)"
                value={String(relHealth.conversations_last_90d)}
                color={relHealth.conversations_last_90d > 0 ? colors.green : colors.textMuted}
              />
            )}
            {relHealth.unique_contacts_engaged != null && (
              <HealthMetric
                label="Contacts Engaged"
                value={String(relHealth.unique_contacts_engaged)}
                color={colors.accent}
              />
            )}
            {relHealth.coverage_percentage != null && (
              <HealthMetric
                label="Coverage"
                value={`${Math.round(relHealth.coverage_percentage)}%`}
                color={relHealth.coverage_percentage > 60 ? colors.green : colors.yellow}
              />
            )}
            {relHealth.days_since_last_interaction != null && (
              <HealthMetric
                label="Days Since Last"
                value={String(relHealth.days_since_last_interaction)}
                color={relHealth.days_since_last_interaction > 14 ? colors.red : relHealth.days_since_last_interaction > 7 ? colors.yellow : colors.green}
              />
            )}
          </div>

          {relHealth.coverage_gaps && relHealth.coverage_gaps.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Coverage Gaps
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {relHealth.coverage_gaps.map((gap: string, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: colors.yellow, fontSize: 13, flexShrink: 0 }}>&#9888;</span>
                    <span style={{ fontSize: 12, color: colors.text }}>{gap}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Deals" count={deals.length}>
            {deals.length === 0 ? (
              <EmptyText>No open deals for this account</EmptyText>
            ) : (
              <>
                {openDeals.length === 0 && <EmptyText>No open deals for this account</EmptyText>}
                {openDeals.map((d: any, i: number) => (
                  <DealRow key={i} deal={d} />
                ))}
                {closedDeals.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, color: colors.textDim, padding: '8px 0 4px', fontWeight: 600 }}>CLOSED</div>
                    {closedDeals.map((d: any, i: number) => (
                      <DealRow key={`c${i}`} deal={d} muted />
                    ))}
                  </>
                )}
              </>
            )}
          </Card>

          <Card title="Findings" count={findings.length}>
            {findings.length === 0 ? (
              <EmptyText>No findings for this account</EmptyText>
            ) : (
              Object.entries(findingsByDeal).map(([dealName, dealFindings]) => (
                <div key={dealName} style={{ marginBottom: 12 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: colors.textDim,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    padding: '6px 0 4px', borderBottom: `1px solid ${colors.border}`,
                  }}>
                    {dealName}
                  </div>
                  {dealFindings.map((f: any, i: number) => {
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
                              borderRadius: 6, padding: 4, zIndex: 20,
                              display: 'flex', flexDirection: 'column', gap: 2, minWidth: 80,
                              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                            }}>
                              {SNOOZE_OPTIONS.map(opt => (
                                <button
                                  key={opt.days}
                                  onClick={() => snoozeFinding(f.id, opt.days)}
                                  style={{
                                    fontSize: 11, padding: '4px 8px', borderRadius: 4,
                                    background: 'transparent', border: 'none',
                                    color: colors.textSecondary, cursor: 'pointer',
                                    textAlign: 'left', transition: 'background 0.15s',
                                  }}
                                  onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; }}
                                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
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
                            onMouseEnter={e => { e.currentTarget.style.borderColor = colors.red; e.currentTarget.style.color = colors.red; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.color = colors.textMuted; }}
                          >
                            {dismissingId === f.id ? '...' : 'Dismiss'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </Card>

          <Card title="Conversations" count={conversations.length}>
            {conversations.length === 0 ? (
              <EmptyText>No linked conversations</EmptyText>
            ) : (
              conversations.map((c: any, i: number) => {
                const lm = linkMethodPill(c.link_method);
                return (
                  <div key={i} style={{ padding: '10px 0', borderBottom: `1px solid ${colors.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: colors.text, flex: 1 }}>{c.title || 'Untitled'}</p>
                      {c.deal_name && (
                        <span style={{
                          fontSize: 10, fontWeight: 500, padding: '1px 6px', borderRadius: 3,
                          background: colors.accentSoft, color: colors.accent,
                        }}>
                          {c.deal_name}
                        </span>
                      )}
                      {lm && (
                        <span style={{
                          fontSize: 10, fontWeight: 500, padding: '1px 6px', borderRadius: 3,
                          background: lm.bg, color: lm.color,
                        }}>
                          {lm.label}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
                      {c.date && <span>{formatDate(c.date)}</span>}
                      {c.duration_minutes != null && <span>{c.duration_minutes}m</span>}
                      {c.participant_count != null && <span>{c.participant_count} participants</span>}
                    </div>
                    {c.summary && (
                      <p style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 1.4 }}>
                        {c.summary.length > 100 ? c.summary.slice(0, 100) + '…' : c.summary}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </Card>

          <Card title="Recent Activity" count={activities.length}>
            {activities.length === 0 ? (
              <EmptyText>No activity records</EmptyText>
            ) : (
              activities.slice(0, 15).map((a: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: `1px solid ${colors.border}` }}>
                  <span style={{ fontSize: 12, color: colors.textMuted, width: 60, flexShrink: 0 }}>
                    {a.timestamp ? formatTimeAgo(a.timestamp) : ''}
                  </span>
                  <p style={{ fontSize: 12, color: colors.text, flex: 1 }}>
                    {a.subject || a.type || 'Activity'}
                  </p>
                </div>
              ))
            )}
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Contacts" count={contacts.length}>
            {contacts.length === 0 ? (
              <EmptyText>No contacts at this account</EmptyText>
            ) : (
              sortedContacts.map((c: any, i: number) => {
                const eng = engagementDot(c.engagement_level);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${colors.border}` }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', background: colors.surfaceHover,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 600, color: colors.textSecondary, flexShrink: 0,
                    }}>
                      {(c.name || c.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12, color: colors.text }}>{c.name || c.email || 'Unknown'}</span>
                      {c.title && <span style={{ fontSize: 11, color: colors.textMuted, display: 'block' }}>{c.title}</span>}
                      {c.role && <span style={{ fontSize: 10, color: colors.textDim }}>{c.role}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      {c.conversation_count != null && (
                        <span style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.textMuted }}>
                          {c.conversation_count} conv
                        </span>
                      )}
                      <span style={{
                        fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                        background: `${eng.color}18`, color: eng.color,
                      }}>
                        {eng.label}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </Card>

          <Card title="Account Details">
            <DetailRow label="Domain" value={account.domain} />
            <DetailRow label="Industry" value={account.industry} />
            <DetailRow label="Employees" value={account.employee_count ? String(account.employee_count) : undefined} />
            <DetailRow label="Revenue" value={account.annual_revenue ? formatCurrency(Number(account.annual_revenue)) : undefined} />
            <DetailRow label="Owner" value={account.owner_email || account.owner} />
            <DetailRow label="Created" value={account.created_at ? formatDate(account.created_at) : undefined} />
          </Card>

          {accountId && (
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
                  placeholder="Ask about this account..."
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

      <AnalysisModal
        scope={{ type: 'account', entity_id: accountId }}
        visible={analysisOpen}
        onClose={() => setAnalysisOpen(false)}
      />
    </div>
  );
}

function Card({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{title}</h3>
        {count !== undefined && <span style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.textMuted }}>{count}</span>}
      </div>
      {children}
    </div>
  );
}

function DealRow({ deal, muted }: { deal: any; muted?: boolean }) {
  const findingsCount = deal.findings_count || 0;
  const criticalCount = deal.critical_findings_count || 0;
  return (
    <div
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 0', borderBottom: `1px solid ${colors.border}`,
        opacity: muted ? 0.5 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link to={`/deals/${deal.id}`} style={{ fontSize: 13, fontWeight: 500, color: colors.accent, textDecoration: 'none' }}>
          {deal.name || 'Unnamed'}
        </Link>
        <div style={{ display: 'flex', gap: 8, marginTop: 2, fontSize: 11, color: colors.textMuted, alignItems: 'center' }}>
          <span style={{ textTransform: 'capitalize' }}>{(deal.stage_normalized || deal.stage || '').replace(/_/g, ' ')}</span>
          {deal.close_date && <span>· {formatDate(deal.close_date)}</span>}
          {deal.days_in_current_stage != null && (
            <span style={{ fontFamily: fonts.mono }}>{deal.days_in_current_stage}d in stage</span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {findingsCount > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
            background: colors.accentSoft, color: colors.accent,
          }}>
            {findingsCount}
          </span>
        )}
        {criticalCount > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
            background: `${colors.red}15`, color: colors.red,
          }}>
            {criticalCount} critical
          </span>
        )}
        <span style={{ fontSize: 13, fontFamily: fonts.mono, color: colors.text }}>
          {formatCurrency(Number(deal.amount) || 0)}
        </span>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${colors.border}` }}>
      <span style={{ fontSize: 12, color: colors.textMuted }}>{label}</span>
      <span style={{ fontSize: 12, color: colors.text }}>{value}</span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: colors.textDim, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: fonts.mono, color: colors.text, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12, color: colors.textMuted, padding: '8px 0' }}>{children}</p>;
}

function HealthMetric({ label, value, color, detail }: { label: string; value: string; color: string; detail?: string }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: color, boxShadow: `0 0 6px ${color}40`,
        }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase' }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: colors.text, textTransform: 'capitalize', marginBottom: 4 }}>
        {value || '--'}
      </div>
      {detail && (
        <p style={{ fontSize: 11, color: colors.textSecondary, lineHeight: 1.4 }}>
          {detail}
        </p>
      )}
    </div>
  );
}

function statusColor(status?: string): string {
  switch (status) {
    case 'strong': case 'healthy': case 'good': return colors.green;
    case 'moderate': case 'stable': case 'at_risk': return colors.yellow;
    case 'weak': case 'declining': case 'poor': return colors.orange;
    case 'cold': case 'critical': return colors.red;
    default: return colors.textMuted;
  }
}
