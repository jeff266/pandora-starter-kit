import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatDate, formatTimeAgo, severityColor } from '../lib/format';
import Skeleton from '../components/Skeleton';
import { DossierNarrative, ScopedAnalysis } from '../components/shared';

export default function DealDetail() {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();
  const [dossier, setDossier] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
  }, [dealId]);

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
  const contactsList = dossier.contacts || [];
  const activities = dossier.activities || [];
  const conversations = dossier.conversations || [];
  const stageHistory = dossier.stage_history || [];
  const narrative = dossier.narrative;
  const coverageGapsData = dossier.coverage_gaps || {};
  const coverageGapMessages: string[] = [];
  if (coverageGapsData.contacts_never_called?.length > 0) {
    const names = coverageGapsData.contacts_never_called.map((c: any) => c.name || c.email).join(', ');
    coverageGapMessages.push(`${coverageGapsData.contacts_never_called.length} contact(s) never on a call: ${names}`);
  }
  if (coverageGapsData.days_since_last_call != null && coverageGapsData.days_since_last_call > 14) {
    coverageGapMessages.push(`${coverageGapsData.days_since_last_call} days since last call`);
  }
  if (coverageGapsData.total_contacts === 0) {
    coverageGapMessages.push('No contacts linked to this deal');
  }

  const healthItems = [
    { label: 'Activity', value: health.activity_recency?.status, color: statusColor(health.activity_recency?.status) },
    { label: 'Threading', value: health.threading?.status, color: statusColor(health.threading?.status) },
    { label: 'Velocity', value: health.stage_velocity?.status, color: statusColor(health.stage_velocity?.status) },
    { label: 'Data', value: `${health.data_completeness?.score || 0}%`, color: (health.data_completeness?.score || 0) > 60 ? colors.green : colors.yellow },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Deal Header */}
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
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
                {h.value || '--'}
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
      {coverageGapMessages.length > 0 && (
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {coverageGapMessages.map((msg: string, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ color: colors.yellow, fontSize: 14, marginTop: 1, flexShrink: 0 }}>&#9888;</span>
                <p style={{ fontSize: 13, color: colors.text, lineHeight: 1.4 }}>{msg}</p>
              </div>
            ))}
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
              findingsList.map((f: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 0', borderBottom: `1px solid ${colors.border}` }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: severityColor(f.severity), marginTop: 5, flexShrink: 0,
                    boxShadow: `0 0 6px ${severityColor(f.severity)}40`,
                  }} />
                  <div>
                    <p style={{ fontSize: 13, color: colors.text }}>{f.message}</p>
                    <span style={{ fontSize: 11, color: colors.textMuted }}>{f.skill_id} · {formatTimeAgo(f.found_at)}</span>
                  </div>
                </div>
              ))
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
                        {s.stage?.replace(/_/g, ' ') || s.value}
                      </span>
                      <div style={{ fontSize: 11, color: colors.textMuted }}>
                        {s.entered_at ? formatDate(s.entered_at) : ''} {s.days_in_stage ? `· ${s.days_in_stage}d` : ''}
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
              conversations.map((c: any, i: number) => (
                <div key={i} style={{ padding: '8px 0', borderBottom: `1px solid ${colors.border}` }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>
                    {c.title || 'Untitled conversation'}
                  </p>
                  <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                    {c.date ? formatDate(c.date) : ''} {c.duration_minutes ? `· ${c.duration_minutes}min` : ''} {c.participant_count ? `· ${c.participant_count} participants` : ''}
                  </div>
                  {c.summary && (
                    <p style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 1.4 }}>
                      {c.summary.slice(0, 200)}{c.summary.length > 200 ? '...' : ''}
                    </p>
                  )}
                </div>
              ))
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
              contactsList.map((c: any, i: number) => (
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
                  </div>
                  {c.role && (
                    <span style={{
                      fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                      background: colors.accentSoft, color: colors.accent, textTransform: 'capitalize',
                    }}>
                      {c.role}
                    </span>
                  )}
                </div>
              ))
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

          {/* Scoped Analysis */}
          {dealId && (
            <div style={{ marginTop: 0 }}>
              <ScopedAnalysis
                scope={{ type: 'deal', entity_id: dealId }}
                workspaceId=""
              />
            </div>
          )}
        </div>
      </div>
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
