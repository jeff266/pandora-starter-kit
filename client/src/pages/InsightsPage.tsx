import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatDateTime, formatTimeAgo, severityColor, severityBg } from '../lib/format';
import Skeleton from '../components/Skeleton';

export default function InsightsPage() {
  const navigate = useNavigate();
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
                return (
                  <div
                    key={f.id || i}
                    style={{
                      display: 'flex', gap: 10, padding: '10px 16px',
                      borderBottom: `1px solid ${colors.border}`,
                      opacity: isResolved ? 0.5 : 1,
                      cursor: f.deal_id ? 'pointer' : 'default',
                    }}
                    onClick={() => f.deal_id && navigate(`/deals/${f.deal_id}`)}
                    onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: severityColor(f.severity), marginTop: 5, flexShrink: 0,
                      boxShadow: `0 0 6px ${severityColor(f.severity)}40`,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, color: colors.text, lineHeight: 1.4 }}>
                        {f.message}
                      </p>
                      <div style={{ display: 'flex', gap: 12, marginTop: 3, fontSize: 11, color: colors.textMuted }}>
                        <span>{f.skill_id}</span>
                        {f.deal_name && <span style={{ color: colors.accent }}>{f.deal_name}</span>}
                        {f.owner_email && <span>{f.owner_email}</span>}
                        <span>{f.found_at ? formatTimeAgo(f.found_at) : ''}</span>
                        {isResolved && <span style={{ color: colors.green }}>Resolved</span>}
                      </div>
                    </div>
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
