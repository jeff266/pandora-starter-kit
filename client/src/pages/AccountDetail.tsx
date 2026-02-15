import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatDate, formatTimeAgo, severityColor } from '../lib/format';
import Skeleton from '../components/Skeleton';
import { DossierNarrative, ScopedAnalysis } from '../components/shared';

export default function AccountDetail() {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const [dossier, setDossier] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
  }, [accountId]);

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

  const openDeals = deals.filter((d: any) => !['closed_won', 'closed_lost'].includes(d.stage_normalized));
  const closedDeals = deals.filter((d: any) => ['closed_won', 'closed_lost'].includes(d.stage_normalized));

  const roleGroups: Record<string, any[]> = {};
  contacts.forEach((c: any) => {
    const role = c.role || 'Unknown role';
    if (!roleGroups[role]) roleGroups[role] = [];
    roleGroups[role].push(c);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Account Header */}
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 20,
      }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: colors.text }}>
          {account.name || 'Unnamed Account'}
        </h2>
        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: colors.textMuted }}>
          {account.domain && <span>{account.domain}</span>}
          {account.industry && <span>{account.industry}</span>}
          {account.employee_count && <span>{account.employee_count} employees</span>}
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 12 }}>
          <MiniStat label="Total Deals" value={String(rel.total_deals || deals.length)} />
          <MiniStat label="Open Value" value={formatCurrency(Number(rel.open_value) || 0)} />
          <MiniStat label="Won Value" value={formatCurrency(Number(rel.won_value) || 0)} />
        </div>
      </div>

      {/* AI Narrative */}
      {accountId && (
        <DossierNarrative
          narrative={narrative}
          onGenerate={() => fetchDossier(true)}
        />
      )}

      {/* Relationship Health Panel */}
      {relHealth && Object.keys(relHealth).length > 0 && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 20,
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 16 }}>
            Relationship Health
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {relHealth.overall && (
              <HealthMetric
                label="Overall"
                value={relHealth.overall}
                color={statusColor(relHealth.overall)}
              />
            )}
            {relHealth.engagement_trend && (
              <HealthMetric
                label="Engagement Trend"
                value={relHealth.engagement_trend}
                color={statusColor(relHealth.engagement_trend === 'increasing' ? 'strong' : relHealth.engagement_trend === 'declining' ? 'weak' : 'moderate')}
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

      {/* Two Column */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Deals */}
          <Card title="Deals" count={deals.length}>
            {deals.length === 0 ? (
              <EmptyText>No deals for this account</EmptyText>
            ) : (
              <>
                {openDeals.map((d: any, i: number) => (
                  <DealRow key={i} deal={d} onClick={() => navigate(`/deals/${d.id}`)} />
                ))}
                {closedDeals.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, color: colors.textDim, padding: '8px 0 4px', fontWeight: 600 }}>CLOSED</div>
                    {closedDeals.map((d: any, i: number) => (
                      <DealRow key={`c${i}`} deal={d} muted onClick={() => navigate(`/deals/${d.id}`)} />
                    ))}
                  </>
                )}
              </>
            )}
          </Card>

          {/* Conversations */}
          <Card title="Conversations" count={conversations.length}>
            {conversations.length === 0 ? (
              <EmptyText>No linked conversations</EmptyText>
            ) : (
              conversations.map((c: any, i: number) => (
                <div key={i} style={{ padding: '8px 0', borderBottom: `1px solid ${colors.border}` }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>{c.title || 'Untitled'}</p>
                  <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                    {c.date ? formatDate(c.date) : ''} {c.deal_name ? `· ${c.deal_name}` : ''}
                  </div>
                </div>
              ))
            )}
          </Card>

          {/* Activity */}
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

        {/* Right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Contact Map */}
          <Card title="Contact Map" count={contacts.length}>
            {contacts.length === 0 ? (
              <EmptyText>No contacts at this account</EmptyText>
            ) : (
              Object.entries(roleGroups).map(([role, members]) => (
                <div key={role} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                    {role}
                  </div>
                  {members.map((c: any, i: number) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%', background: colors.surfaceHover,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 600, color: colors.textSecondary, flexShrink: 0,
                      }}>
                        {(c.name || c.email || '?').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <span style={{ fontSize: 12, color: colors.text }}>{c.name || c.email || 'Unknown'}</span>
                        {c.title && <span style={{ fontSize: 11, color: colors.textMuted, display: 'block' }}>{c.title}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </Card>

          {/* Account Details */}
          <Card title="Account Details">
            <DetailRow label="Domain" value={account.domain} />
            <DetailRow label="Industry" value={account.industry} />
            <DetailRow label="Employees" value={account.employee_count ? String(account.employee_count) : undefined} />
            <DetailRow label="Revenue" value={account.annual_revenue ? formatCurrency(Number(account.annual_revenue)) : undefined} />
            <DetailRow label="Created" value={account.created_at ? formatDate(account.created_at) : undefined} />
          </Card>

          {/* Findings */}
          <Card title="Findings" count={findings.length}>
            {findings.length === 0 ? (
              <EmptyText>No findings for this account</EmptyText>
            ) : (
              findings.map((f: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: `1px solid ${colors.border}` }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: severityColor(f.severity), marginTop: 4, flexShrink: 0,
                  }} />
                  <p style={{ fontSize: 12, color: colors.text }}>{f.message}</p>
                </div>
              ))
            )}
          </Card>

          {/* Scoped Analysis */}
          {accountId && (
            <div style={{ marginTop: 0 }}>
              <ScopedAnalysis
                scope={{ type: 'account', entity_id: accountId }}
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
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{title}</h3>
        {count !== undefined && <span style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.textMuted }}>{count}</span>}
      </div>
      {children}
    </div>
  );
}

function DealRow({ deal, muted, onClick }: { deal: any; muted?: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 0', borderBottom: `1px solid ${colors.border}`, cursor: 'pointer',
        opacity: muted ? 0.5 : 1,
      }}
      onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div>
        <span style={{ fontSize: 13, fontWeight: 500, color: colors.accent }}>{deal.name || 'Unnamed'}</span>
        <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
          {deal.owner || ''} · {deal.stage_normalized?.replace(/_/g, ' ') || deal.stage || ''}
        </div>
      </div>
      <span style={{ fontSize: 13, fontFamily: fonts.mono, color: colors.text }}>
        {formatCurrency(Number(deal.amount) || 0)}
      </span>
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
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          boxShadow: `0 0 6px ${color}40`,
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
  if (!status) return colors.textMuted;
  switch (status.toLowerCase()) {
    case 'strong': case 'active': case 'fast': case 'multi': case 'broad': return colors.green;
    case 'moderate': case 'cooling': case 'normal': case 'dual': return colors.yellow;
    case 'weak': case 'stale': case 'slow': case 'single': case 'narrow': return colors.red;
    default: return colors.textMuted;
  }
}
