import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatDateTime, formatTimeAgo, severityColor, severityBg } from '../lib/format';
import Skeleton from '../components/Skeleton';
import SectionErrorBoundary from '../components/SectionErrorBoundary';
import { useDemoMode } from '../contexts/DemoModeContext';
import { useIsMobile } from '../hooks/useIsMobile';

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

export default function InsightsPage() {
  const navigate = useNavigate();
  const { anon } = useDemoMode();
  const isMobile = useIsMobile();
  const [findings, setFindings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState({
    severity: 'all',
    status: 'all',
    skill: '',
  });
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [crmInfo, setCrmInfo] = useState<{ crm: string | null; portalId?: number | null; instanceUrl?: string | null }>({ crm: null });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [snoozedIds, setSnoozedIds] = useState<Set<string>>(new Set());
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  const DISMISS_REASONS = [
    { key: 'wrong_data', label: 'Data is wrong' },
    { key: 'already_handled', label: 'Already handled' },
    { key: 'too_sensitive', label: 'Threshold too sensitive' },
    { key: 'not_relevant', label: 'Not relevant to us' },
  ];

  const limit = 30;

  const fetchFindings = useCallback(async (reset = false) => {
    const o = reset ? 0 : offset;
    if (reset) {
      setLoading(true);
      setFindings([]);
    } else {
      setLoadingMore(true);
    }

    try {
      const params = new URLSearchParams();
      if (filters.severity !== 'all') params.set('severity', filters.severity);
      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.skill) params.set('skill_id', filters.skill);
      params.set('limit', String(limit));
      params.set('offset', String(o));
      params.set('sort', 'recency');

      const data = await api.get(`/findings?${params.toString()}`);
      const items = data.findings || data || [];
      if (reset) {
        setFindings(items);
      } else {
        setFindings(prev => [...prev, ...items]);
      }
      setHasMore(items.length === limit);
      setOffset(o + items.length);
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [offset, filters]);

  useEffect(() => {
    fetchFindings(true);
  }, [filters.severity, filters.status, filters.skill]);

  useEffect(() => {
    api.get('/crm/link-info').then(setCrmInfo).catch(() => {});
  }, []);

  const confirmFinding = async (findingId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.post('/feedback', {
        targetType: 'finding',
        targetId: findingId,
        signalType: 'confirm',
        source: 'command_center',
      });
      setConfirmedIds(prev => new Set(prev).add(findingId));
    } catch (err) {
      console.error('Failed to confirm finding:', err);
    }
  };

  const dismissFinding = async (findingId: string, severity: string, category: string, reason: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await api.post('/feedback', {
        targetType: 'finding',
        targetId: findingId,
        signalType: 'dismiss',
        metadata: { severity, category, reason },
        source: 'command_center',
      });
      setDismissedIds(prev => new Set(prev).add(findingId));
      setDismissingId(null);
    } catch (err) {
      console.error('Failed to dismiss finding:', err);
    }
  };

  const snoozeFinding = async (findingId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.post(`/findings/${findingId}/snooze`, { days: 7 });
      setSnoozedIds(prev => new Set(prev).add(findingId));
    } catch (err) {
      console.error('Failed to snooze finding:', err);
    }
  };

  const grouped = groupByDate(findings);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters */}
      <div style={{
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '10px 16px',
      }}>
        <FilterGroup
          label="Severity"
          options={['all', 'act', 'watch', 'notable']}
          value={filters.severity}
          onChange={v => setFilters(p => ({ ...p, severity: v }))}
        />
        <div style={{ width: 1, height: 20, background: colors.border }} />
        <FilterGroup
          label="Status"
          options={['all', 'active', 'resolved']}
          value={filters.status}
          onChange={v => setFilters(p => ({ ...p, status: v }))}
        />
      </div>

      {/* Feed */}
      <SectionErrorBoundary fallbackMessage="Something went wrong loading findings.">
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={52} />)}
        </div>
      ) : findings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: colors.textMuted, fontSize: 14 }}>
          No findings match the current filters
        </div>
      ) : (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          overflow: 'hidden',
        }}>
          {Object.entries(grouped).map(([dateLabel, items]) => (
            <div key={dateLabel}>
              <div style={{
                padding: '8px 16px',
                fontSize: 11,
                fontWeight: 600,
                color: colors.textDim,
                background: colors.surfaceRaised,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                {dateLabel}
              </div>
              {items.map((f: any, i: number) => {
                const isResolved = f.status === 'resolved';
                const isExpanded = expandedId === f.id;
                const isSnoozed = snoozedIds.has(f.id);
                const getActionabilityColor = (actionability: string) => {
                  switch (actionability) {
                    case 'immediate': return colors.red;
                    case 'soon': return colors.yellow;
                    case 'monitor': return colors.accent;
                    default: return colors.textMuted;
                  }
                };
                const getActionabilityBg = (actionability: string) => {
                  switch (actionability) {
                    case 'immediate': return colors.redSoft;
                    case 'soon': return colors.yellowSoft;
                    case 'monitor': return colors.accentSoft;
                    default: return 'transparent';
                  }
                };
                return (
                  <div
                    key={f.id || i}
                    style={{
                      borderBottom: `1px solid ${colors.border}`,
                      opacity: isResolved ? 0.5 : isSnoozed ? 0.3 : dismissedIds.has(f.id) ? 0.4 : 1,
                      transition: 'opacity 0.3s',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex', gap: 10, padding: '10px 16px',
                        cursor: 'pointer',
                      }}
                      onClick={() => !isResolved && setExpandedId(isExpanded ? null : f.id)}
                      onMouseEnter={e => !isResolved && (e.currentTarget.style.background = colors.surfaceHover)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{
                        width: 7, height: 7, borderRadius: '50%',
                        background: severityColor(f.severity), marginTop: 5, flexShrink: 0,
                        boxShadow: `0 0 6px ${severityColor(f.severity)}40`,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, color: colors.text, lineHeight: 1.4 }}>
                          {anon.text(f.message)}
                        </p>
                        <div style={{ display: 'flex', gap: 12, marginTop: 3, fontSize: 11, color: colors.textMuted, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span>{f.skill_id}</span>
                          {f.deal_name && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              <a
                                href={`/deals/${f.deal_id}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/deals/${f.deal_id}`);
                                }}
                                style={{ color: colors.accent, textDecoration: 'none', cursor: 'pointer' }}
                              >
                                {anon.deal(f.deal_name)}
                              </a>
                              {(() => {
                                const crmUrl = buildCrmUrl(crmInfo.crm, crmInfo.portalId ?? null, crmInfo.instanceUrl ?? null, f.deal_source_id, f.deal_source);
                                if (!crmUrl) return null;
                                return (
                                  <a
                                    href={crmUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={crmInfo.crm === 'hubspot' ? 'Open in HubSpot' : 'Open in Salesforce'}
                                    onClick={e => e.stopPropagation()}
                                    style={{ display: 'inline-flex', color: `${colors.accent}99`, transition: 'color 0.15s' }}
                                    onMouseEnter={e => { e.currentTarget.style.color = colors.accent; }}
                                    onMouseLeave={e => { e.currentTarget.style.color = `${colors.accent}99`; }}
                                  >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                      <polyline points="15 3 21 3 21 9" />
                                      <line x1="10" y1="14" x2="21" y2="3" />
                                    </svg>
                                  </a>
                                );
                              })()}
                            </span>
                          )}
                          {f.owner_email && <span>{anon.email(f.owner_email)}</span>}
                          <span>{f.found_at ? formatTimeAgo(f.found_at) : ''}</span>
                          {isResolved && <span style={{ color: colors.green }}>Resolved</span>}
                        </div>
                      </div>
                      {!isResolved && (
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                          {confirmedIds.has(f.id) ? (
                            <span style={{ fontSize: 11, color: colors.green, fontWeight: 500 }}>✓ Accurate</span>
                          ) : dismissedIds.has(f.id) ? (
                            <span style={{ fontSize: 11, color: colors.textMuted, fontWeight: 500 }}>Not Right</span>
                          ) : dismissingId === f.id ? (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                              {DISMISS_REASONS.map(r => (
                                <button
                                  key={r.key}
                                  onClick={(e) => dismissFinding(f.id, f.severity, f.category, r.key, e)}
                                  style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'transparent', border: `1px solid ${colors.border}`, color: colors.textSecondary, cursor: 'pointer', whiteSpace: 'nowrap' }}
                                >
                                  {r.label}
                                </button>
                              ))}
                              <button
                                onClick={(e) => { e.stopPropagation(); setDismissingId(null); }}
                                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'transparent', border: 'none', color: colors.textMuted, cursor: 'pointer' }}
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <>
                              <button
                                onClick={(e) => confirmFinding(f.id, e)}
                                style={{
                                  fontSize: 11,
                                  fontWeight: 500,
                                  padding: '3px 8px',
                                  borderRadius: 4,
                                  background: 'transparent',
                                  border: `1px solid ${colors.border}`,
                                  color: colors.green,
                                  cursor: 'pointer',
                                }}
                                title="Mark as accurate"
                              >
                                ✓ Accurate
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setDismissingId(f.id); }}
                                style={{
                                  fontSize: 11,
                                  fontWeight: 500,
                                  padding: '3px 8px',
                                  borderRadius: 4,
                                  background: 'transparent',
                                  border: `1px solid ${colors.border}`,
                                  color: colors.textMuted,
                                  cursor: 'pointer',
                                }}
                                title="Mark as not right"
                              >
                                ✗ Not Right
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    
                    {/* Expanded content */}
                    {isExpanded && (
                      <div
                        style={{
                          maxHeight: '500px',
                          overflow: 'hidden',
                          transition: 'max-height 0.3s ease',
                          padding: '12px 16px',
                          background: colors.surfaceRaised,
                          borderTop: `1px solid ${colors.border}`,
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {/* Full message */}
                          <div>
                            <p style={{ fontSize: 11, fontWeight: 600, color: colors.textDim, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              Details
                            </p>
                            <p style={{ fontSize: 12, color: colors.text, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {anon.text(f.message)}
                            </p>
                          </div>

                          {/* Metric info */}
                          {(f.metric_value !== null || f.metric_context) && (
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                              {f.metric_value !== null && (
                                <div>
                                  <p style={{ fontSize: 10, fontWeight: 600, color: colors.textDim, marginBottom: 2, textTransform: 'uppercase' }}>Metric</p>
                                  <p style={{ fontSize: 12, color: colors.text, fontWeight: 500 }}>{f.metric_value}</p>
                                </div>
                              )}
                              {f.metric_context && (
                                <div>
                                  <p style={{ fontSize: 10, fontWeight: 600, color: colors.textDim, marginBottom: 2, textTransform: 'uppercase' }}>Context</p>
                                  <p style={{ fontSize: 12, color: colors.text, fontWeight: 500 }}>{anon.text(f.metric_context)}</p>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Entity info */}
                          {(f.entity_type || f.entity_name) && (
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                              {f.entity_type && (
                                <div>
                                  <p style={{ fontSize: 10, fontWeight: 600, color: colors.textDim, marginBottom: 2, textTransform: 'uppercase' }}>Entity Type</p>
                                  <p style={{ fontSize: 12, color: colors.text, fontWeight: 500, textTransform: 'capitalize' }}>{f.entity_type}</p>
                                </div>
                              )}
                              {f.entity_name && (
                                <div>
                                  <p style={{ fontSize: 10, fontWeight: 600, color: colors.textDim, marginBottom: 2, textTransform: 'uppercase' }}>Entity Name</p>
                                  <p style={{ fontSize: 12, color: colors.text, fontWeight: 500 }}>{anon.text(f.entity_name)}</p>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Actionability badge */}
                          {f.actionability && (
                            <div>
                              <p style={{ fontSize: 10, fontWeight: 600, color: colors.textDim, marginBottom: 4, textTransform: 'uppercase' }}>Actionability</p>
                              <span style={{
                                display: 'inline-block',
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '4px 10px',
                                borderRadius: 4,
                                background: getActionabilityBg(f.actionability),
                                color: getActionabilityColor(f.actionability),
                                textTransform: 'capitalize',
                              }}>
                                {f.actionability}
                              </span>
                            </div>
                          )}

                          {/* Snooze and navigation buttons */}
                          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                            {isSnoozed ? (
                              <span style={{ fontSize: 11, color: colors.green, fontWeight: 500 }}>Snoozed for 7 days</span>
                            ) : (
                              <>
                                <button
                                  onClick={(e) => snoozeFinding(f.id, e)}
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 500,
                                    padding: '6px 12px',
                                    borderRadius: 4,
                                    background: 'transparent',
                                    border: `1px solid ${colors.border}`,
                                    color: colors.textSecondary,
                                    cursor: 'pointer',
                                    transition: 'all 0.15s',
                                  }}
                                  onMouseEnter={e => {
                                    e.currentTarget.style.borderColor = colors.accent;
                                    e.currentTarget.style.color = colors.accent;
                                  }}
                                  onMouseLeave={e => {
                                    e.currentTarget.style.borderColor = colors.border;
                                    e.currentTarget.style.color = colors.textSecondary;
                                  }}
                                >
                                  Snooze 7 days
                                </button>
                                {(f.deal_id || f.account_id) && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (f.deal_id) {
                                        navigate(`/deals/${f.deal_id}`);
                                      } else if (f.account_id) {
                                        navigate(`/accounts/${f.account_id}`);
                                      }
                                    }}
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 500,
                                      padding: '6px 12px',
                                      borderRadius: 4,
                                      background: colors.accent,
                                      border: 'none',
                                      color: '#fff',
                                      cursor: 'pointer',
                                      transition: 'opacity 0.15s',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; }}
                                    onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                                  >
                                    View {f.deal_id ? 'Deal' : 'Account'}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {hasMore && (
            <div style={{ padding: 16, textAlign: 'center' }}>
              <button
                onClick={() => fetchFindings(false)}
                disabled={loadingMore}
                style={{
                  fontSize: 12, fontWeight: 600, padding: '8px 20px', borderRadius: 6,
                  background: colors.surfaceHover, color: colors.textSecondary,
                  opacity: loadingMore ? 0.6 : 1,
                }}
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
      </SectionErrorBoundary>
    </div>
  );
}

function FilterGroup({ label, options, value, onChange }: {
  label: string; options: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: colors.textDim, fontWeight: 600 }}>{label}:</span>
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          style={{
            fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 4,
            background: value === opt ? colors.surfaceActive : 'transparent',
            color: value === opt ? colors.text : colors.textMuted,
            textTransform: 'capitalize',
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function groupByDate(findings: any[]): Record<string, any[]> {
  const groups: Record<string, any[]> = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  for (const f of findings) {
    const d = new Date(f.found_at);
    let label: string;
    if (d >= today) label = 'Today';
    else if (d >= yesterday) label = 'Yesterday';
    else if (d >= weekAgo) label = 'This Week';
    else label = 'Older';

    if (!groups[label]) groups[label] = [];
    groups[label].push(f);
  }
  return groups;
}
