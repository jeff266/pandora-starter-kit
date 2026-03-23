import React, { useState, useEffect, useCallback } from 'react';
import { colors, fonts } from '../../styles/theme';

interface McpActivityData {
  period_days: number;
  total_calls: number;
  error_count: number;
  success_count: number;
  avg_duration_ms: number | null;
  first_call_at: string | null;
  last_call_at: string | null;
  by_tool: Array<{
    tool_name: string;
    calls: number;
    avg_ms: number | null;
    errors: number;
    last_called: string;
  }>;
  recent_calls: Array<{
    tool_name: string;
    duration_ms: number | null;
    error: string | null;
    called_at: string;
    input_summary: string | null;
  }>;
}

interface McpActivityPanelProps {
  workspaceId: string;
}

const TEAL = '#14b8a6';
const CORAL = '#f97316';
const PERIOD_OPTIONS = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
];

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  const hrs = Math.floor(ms / 3_600_000);
  const days = Math.floor(ms / 86_400_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (hrs < 24) return `${hrs} hr ago`;
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

function SkeletonRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <div style={{ width: 140, height: 10, background: colors.surfaceHover, borderRadius: 3, animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div style={{ flex: 1, height: 6, background: colors.surfaceHover, borderRadius: 3, animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div style={{ width: 48, height: 10, background: colors.surfaceHover, borderRadius: 3, animation: 'pulse 1.5s ease-in-out infinite' }} />
    </div>
  );
}

function StatCard({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div style={{
      flex: 1,
      background: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: 6,
      padding: '10px 12px',
      textAlign: 'center',
      minWidth: 0,
    }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: valueColor ?? colors.text, fontFamily: fonts.sans, lineHeight: 1.2 }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: fonts.sans }}>
        {label}
      </div>
    </div>
  );
}

export default function McpActivityPanel({ workspaceId }: McpActivityPanelProps) {
  const [data, setData] = useState<McpActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [periodDays, setPeriodDays] = useState(30);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setFetchError(null);
    fetch(`/api/workspaces/${workspaceId}/mcp/activity?days=${periodDays}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: McpActivityData) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        setFetchError('Failed to load activity');
        setLoading(false);
      });
  }, [workspaceId, periodDays, refreshKey]);

  useEffect(() => { load(); }, [load]);

  const maxCalls = data && data.by_tool.length > 0
    ? Math.max(...data.by_tool.map(t => t.calls))
    : 1;

  return (
    <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 14 }}>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

      {/* Panel header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: fonts.sans }}>
          MCP Activity
        </span>
        <button
          onClick={() => { setLoading(true); setRefreshKey(k => k + 1); }}
          style={{ fontSize: 11, color: colors.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', fontFamily: fonts.sans }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = colors.accent; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = colors.textMuted; }}
        >
          ↺ Refresh
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {/* Error */}
      {!loading && fetchError && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 12, color: colors.red }}>{fetchError}</span>
          <button
            onClick={() => { setLoading(true); setRefreshKey(k => k + 1); }}
            style={{ fontSize: 12, color: colors.red, background: 'none', border: `1px solid ${colors.red}`, borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontFamily: fonts.sans }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !fetchError && data && data.total_calls === 0 && (
        <div style={{ textAlign: 'center', padding: '20px 16px' }}>
          <div style={{ fontSize: 20, color: TEAL, marginBottom: 8, lineHeight: 1 }}>✦</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6, fontFamily: fonts.sans }}>
            No activity yet
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.6, maxWidth: 280, margin: '0 auto 12px' }}>
            Connect Claude Desktop to start seeing tool calls here. Once connected, this panel shows call frequency, response times, and recent activity.
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted, fontStyle: 'italic', lineHeight: 1.8 }}>
            → Copy config above → paste into Claude Desktop → restart
          </div>
        </div>
      )}

      {/* Data state */}
      {!loading && !fetchError && data && data.total_calls > 0 && (
        <div>
          {/* Period selector */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {PERIOD_OPTIONS.map(opt => {
              const active = opt.value === periodDays;
              return (
                <button
                  key={opt.value}
                  onClick={() => setPeriodDays(opt.value)}
                  style={{
                    padding: '3px 10px',
                    fontSize: 11,
                    fontFamily: fonts.sans,
                    fontWeight: active ? 600 : 400,
                    background: active ? colors.accent : 'transparent',
                    border: `1px solid ${active ? colors.accent : colors.border}`,
                    borderRadius: 4,
                    color: active ? '#fff' : colors.textMuted,
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <StatCard value={String(data.total_calls)} label="Total calls" />
            <StatCard value={String(data.success_count)} label="Success" valueColor={TEAL} />
            <StatCard
              value={String(data.error_count)}
              label="Errors"
              valueColor={data.error_count > 0 ? CORAL : TEAL}
            />
            <StatCard
              value={data.avg_duration_ms != null ? `${data.avg_duration_ms}ms` : '—'}
              label="Avg. speed"
            />
          </div>

          {/* Tool frequency bars */}
          {data.by_tool.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, fontFamily: fonts.sans }}>
                By tool
              </div>
              {data.by_tool.slice(0, 10).map(tool => (
                <div
                  key={tool.tool_name}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}
                  title={`${tool.tool_name}\nAvg: ${tool.avg_ms != null ? `${tool.avg_ms}ms` : '—'} · Errors: ${tool.errors}`}
                >
                  <span style={{
                    width: 180,
                    fontSize: 11,
                    fontFamily: fonts.mono,
                    color: colors.text,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}>
                    {tool.tool_name}
                  </span>
                  <div style={{ flex: 1, height: 6, background: colors.border, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${(tool.calls / maxCalls) * 100}%`,
                      background: tool.errors > 0 ? CORAL : TEAL,
                      borderRadius: 3,
                      transition: 'width 400ms ease',
                    }} />
                  </div>
                  <span style={{ width: 58, fontSize: 11, color: colors.textMuted, textAlign: 'right', flexShrink: 0, fontFamily: fonts.sans }}>
                    {tool.calls} call{tool.calls !== 1 ? 's' : ''}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Recent calls list */}
          {data.recent_calls.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, fontFamily: fonts.sans }}>
                Recent calls
              </div>
              {data.recent_calls.map((call, i) => (
                <div key={i} style={{ marginBottom: call.error ? 10 : 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: call.error ? CORAL : TEAL, flexShrink: 0, lineHeight: 1 }}>
                      {call.error ? '✗' : '✓'}
                    </span>
                    <span style={{
                      flex: 1,
                      fontSize: 11,
                      fontFamily: fonts.mono,
                      color: colors.text,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}>
                      {call.tool_name}
                    </span>
                    <span style={{ fontSize: 11, color: colors.textMuted, flexShrink: 0 }}>
                      {call.duration_ms != null ? `${call.duration_ms}ms` : '—'}
                    </span>
                    <span style={{ fontSize: 11, color: colors.textMuted, flexShrink: 0, minWidth: 64, textAlign: 'right' }}>
                      {timeAgo(call.called_at)}
                    </span>
                  </div>
                  {call.error && (
                    <div style={{ fontSize: 11, color: CORAL, marginLeft: 20, marginTop: 2, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                      {call.error.slice(0, 80)}{call.error.length > 80 ? '…' : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Last active footer */}
          {data.first_call_at && data.last_call_at && (
            <div style={{ fontSize: 11, color: colors.textMuted, borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>
              First connected: {new Date(data.first_call_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              {' · '}
              Last active: {timeAgo(data.last_call_at)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
