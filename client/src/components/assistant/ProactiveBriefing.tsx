import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../../styles/theme';
import InvestigationResults from './InvestigationResults';
import ComparisonBlock from './ComparisonBlock';
import { type GreetingPhase } from './Greeting';

const CURSOR_STYLE: React.CSSProperties = {
  display: 'inline-block',
  width: 2,
  height: '1em',
  background: '#48af9b',
  marginLeft: 2,
  verticalAlign: 'text-bottom',
  animation: 'pandora-blink 0.7s step-end infinite',
};

function formatFindingHeadline(headline: string): string {
  const parts = headline.split(' \u2014 ');
  if (parts.length < 2) return headline;
  const last = parts[parts.length - 1];
  if (/^[a-z][a-z_]+$/.test(last)) {
    const human = last.replace(/_/g, ' ');
    const capitalized = human.charAt(0).toUpperCase() + human.slice(1);
    return [...parts.slice(0, -1), capitalized].join(' \u2014 ');
  }
  return headline;
}

function shortenQuestion(q: string): string {
  const stripped = q
    .replace(/^(Will we|Which|What('?s)?|Are|How many|How|Is|Do|Does|Have|Can)\s+/i, '')
    .replace(/\?$/, '')
    .trim();
  if (stripped.length <= 32) return stripped + '?';
  const words = stripped.split(' ');
  let label = '';
  for (const w of words) {
    if ((label + ' ' + w).trim().length > 30) break;
    label = (label + ' ' + w).trim();
  }
  return label + '?';
}

function formatCurrencyShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export interface InvestigationPath {
  question: string;
  reasoning: string;
  skill_id?: string;
  priority: 'high' | 'medium' | 'low';
  last_run_at?: string | null;
}

export interface TopFinding {
  severity: 'critical' | 'warning';
  headline: string;
  entity?: string;
  amount?: number;
  category?: string;
}

export interface ProactiveBriefingData {
  mode: 'investigation_ready' | 'none';
  investigation_title: string;
  findings_count: number;
  top_finding?: TopFinding;
  investigation_paths: InvestigationPath[];
  can_escalate: boolean;
  escalation_path?: string;
  deltas?: {
    since_label: string;
    new_critical_count: number;
    total_at_risk: number;
    improved_count: number;
    worsened_investigations: string[];
  };
}

export interface GreetingData {
  headline: string;
  subline: string;
  state_summary: string;
  recency_label: string;
  severity: 'calm' | 'attention' | 'urgent';
  week_context?: string;
  questions?: string[];
  metrics: {
    pipeline_value: number;
    coverage_ratio: number;
    critical_count: number;
    warning_count: number;
    deals_moved: number;
  };
  proactive_briefing?: ProactiveBriefingData;
}

export interface BriefMetadata {
  assembled_at: string;
  last_sync_at: string | null;
  is_potentially_stale: boolean;
  stale_reason?: string;
}

interface ProactiveBriefingProps {
  greeting: GreetingData;
  phase?: GreetingPhase;
  typedHeadline?: string;
  typedSubline?: string;
  typedContext?: string;
  cursorTarget?: 'headline' | 'subline' | 'context' | null;
  onInvestigatePath: (path: InvestigationPath) => void;
  onEscalate?: () => void;
  onAskPandora: () => void;
  onQuestionClick?: (question: string) => void;
  investigationStatus?: Map<string, {
    jobId: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    runId?: string;
    error?: string;
  }>;
  brief?: any;
  briefMetadata?: BriefMetadata;
  onRefreshBrief?: () => void;
  workspaceId?: string;
  onBriefRefreshed?: (brief: any) => void;
}

function formatCurrency(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

function formatLastRunTime(timestamp: string): string {
  const hoursSince = Math.round(
    (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60)
  );
  if (hoursSince < 1) return 'less than an hour ago';
  if (hoursSince === 1) return '1 hour ago';
  if (hoursSince < 24) return `${hoursSince} hours ago`;
  const daysSince = Math.round(hoursSince / 24);
  return `${daysSince} day${daysSince > 1 ? 's' : ''} ago`;
}

function getSeverityColor(severity: 'calm' | 'attention' | 'urgent'): string {
  switch (severity) {
    case 'urgent':    return colors.red;
    case 'attention': return colors.yellow;
    default:          return colors.green;
  }
}

function getPriorityDot(priority: 'high' | 'medium' | 'low'): { color: string } {
  switch (priority) {
    case 'high':   return { color: '#ef4444' };
    case 'medium': return { color: '#f59e0b' };
    default:       return { color: colors.textMuted as string };
  }
}

function getBriefNarrative(brief: any): { primary: string | null; focus: string | null } {
  if (!brief?.ai_blurbs) return { primary: null, focus: null };
  const bt = brief.brief_type;
  const blurbs = brief.ai_blurbs;
  if (bt === 'pulse') return { primary: blurbs.pulse_summary ?? null, focus: blurbs.key_action ?? null };
  if (bt === 'friday_recap') return { primary: blurbs.week_summary ?? null, focus: blurbs.next_week_focus ?? null };
  if (bt === 'monday_setup') return { primary: blurbs.overall_summary ?? null, focus: blurbs.rep_conversation ?? null };
  if (bt === 'quarter_close') return { primary: blurbs.quarter_situation ?? null, focus: blurbs.close_plan ?? null };
  return { primary: null, focus: null };
}

export default function ProactiveBriefing({
  greeting,
  phase,
  typedHeadline,
  typedSubline,
  typedContext,
  cursorTarget,
  onInvestigatePath,
  onEscalate,
  onAskPandora,
  onQuestionClick,
  investigationStatus,
  brief,
  briefMetadata,
  onRefreshBrief,
  workspaceId,
  onBriefRefreshed,
}: ProactiveBriefingProps) {
  const navigate = useNavigate();
  const [resultsModal, setResultsModal] = useState<{ skillId: string; runId: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [nextRefreshAt, setNextRefreshAt] = useState<Date | null>(null);
  const [isByok, setIsByok] = useState(false);
  const briefing = greeting.proactive_briefing;
  const isStreaming = phase && !['pills', 'browsing'].includes(phase);
  const severityColor = getSeverityColor(greeting.severity);

  const { primary: briefNarrative, focus: briefFocus } = getBriefNarrative(brief);
  const theNumber = brief?.the_number ?? null;
  const deltas = briefing?.deltas;
  const hasLiveDelta = deltas && (deltas.new_critical_count > 0 || (deltas.total_at_risk ?? 0) > 0);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      if (workspaceId) {
        const result = await fetch(`/api/workspaces/${workspaceId}/brief/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ force: false }),
        }).then(r => r.json());

        setIsByok(result.is_byok || false);

        if (result.skipped && result.skip_reason) {
          setRefreshMessage(result.skip_reason);
          if (result.next_refresh_allowed_at) {
            setNextRefreshAt(new Date(result.next_refresh_allowed_at));
          }
        } else if (result.brief) {
          setRefreshMessage(null);
          setNextRefreshAt(null);
          if (onBriefRefreshed) onBriefRefreshed(result.brief);
          if (onRefreshBrief) onRefreshBrief();
        }
      } else if (onRefreshBrief) {
        await onRefreshBrief();
      }
    } catch {
      setRefreshMessage('Refresh failed. Please try again.');
    } finally {
      setRefreshing(false);
    }
  };

  const formatAssembledAt = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch {
      return '';
    }
  };

  const syncAgoLabel = (() => {
    if (!briefMetadata?.last_sync_at) return null;
    const diffMs = Date.now() - new Date(briefMetadata.last_sync_at).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  })();

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderLeft: `3px solid ${severityColor}`,
        borderRadius: 12,
        padding: 24,
        maxWidth: 800,
        margin: '0 auto',
      }}
    >
      <style>{`
        @keyframes pandora-blink { 50% { opacity: 0; } }
        @keyframes pandora-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes pandora-fade-up { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.textSecondary, fontFamily: fonts.sans }}>
            VP RevOps Brief
          </span>
          <span style={{ color: colors.textDim, fontSize: 12 }}>·</span>
          <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans }}>
            {greeting.recency_label}
          </span>
        </div>
        {greeting.week_context && (
          <span style={{ fontSize: 11, color: colors.textDim, fontFamily: fonts.sans }}>
            {greeting.week_context}
          </span>
        )}
      </div>

      {/* ── Assembly time + staleness line ── */}
      {briefMetadata?.assembled_at && (
        <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, fontFamily: fonts.sans }}>
          <span>As of {formatAssembledAt(briefMetadata.assembled_at)}</span>
          {briefMetadata.is_potentially_stale && syncAgoLabel && (
            <>
              <span style={{ color: colors.textDim }}>·</span>
              <span>
                Sync ran {syncAgoLabel} —{' '}
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  style={{
                    background: 'none', border: 'none', cursor: refreshing ? 'default' : 'pointer',
                    color: colors.accent, fontSize: 11, padding: 0, fontFamily: fonts.sans,
                    opacity: refreshing ? 0.6 : 1,
                  }}
                >
                  {refreshing ? 'refreshing...' : 'refresh ↻'}
                </button>
              </span>
            </>
          )}
          {!briefMetadata.is_potentially_stale && workspaceId && (
            <>
              <span style={{ color: colors.textDim }}>·</span>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                style={{
                  background: 'none', border: 'none', cursor: refreshing ? 'default' : 'pointer',
                  color: colors.textMuted, fontSize: 11, padding: 0, fontFamily: fonts.sans,
                  opacity: refreshing ? 0.6 : 1,
                }}
              >
                {refreshing ? 'refreshing...' : '↻'}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Rate limit message ── */}
      {refreshMessage && !isByok && (
        <div style={{
          fontSize: 11,
          color: colors.textMuted,
          marginBottom: 8,
          fontFamily: fonts.sans,
          lineHeight: 1.5,
        }}>
          {refreshMessage}
          {nextRefreshAt && (
            <span>
              {' '}Next refresh available at {nextRefreshAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}{' '}·{' '}
              <button
                onClick={() => navigate('/settings/llm-config')}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: colors.accent, fontSize: 11, padding: 0, fontFamily: fonts.sans,
                }}
              >
                Add your API key for unlimited refreshes →
              </button>
            </span>
          )}
        </div>
      )}

      {/* ── Staleness banner ── */}
      {briefMetadata?.is_potentially_stale && (
        <div style={{
          background: '#F59E0B20',
          border: '1px solid #F59E0B60',
          borderRadius: 6,
          padding: '8px 12px',
          fontSize: 12,
          color: '#F59E0B',
          marginBottom: 12,
          fontFamily: fonts.sans,
        }}>
          ⚠ A sync ran after this brief was assembled. Some numbers may have changed. Refreshing...
        </div>
      )}

      {/* ── Greeting ── */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{
          fontFamily: fonts.sans,
          fontSize: 20,
          fontWeight: 700,
          lineHeight: 1.3,
          margin: '0 0 6px 0',
          minHeight: '1.3em',
        }}>
          {typedHeadline ?? greeting.headline}
          {cursorTarget === 'headline' && <span style={CURSOR_STYLE} />}
        </h2>
        {(typedSubline || (!isStreaming && greeting.subline)) && (
          <p style={{
            fontFamily: fonts.sans,
            fontSize: 14,
            fontWeight: 400,
            lineHeight: 1.5,
            color: colors.textSecondary,
            margin: 0,
          }}>
            {typedSubline ?? greeting.subline}
            {cursorTarget === 'subline' && <span style={CURSOR_STYLE} />}
          </p>
        )}
      </div>

      {!isStreaming && <>

      {/* ── Brief narrative (replaces state_summary bar when available) ── */}
      {briefNarrative ? (
        <div style={{ marginBottom: 20 }}>
          <p style={{
            fontFamily: fonts.sans,
            fontSize: 13,
            lineHeight: 1.65,
            color: colors.textSecondary,
            margin: '0 0 12px 0',
          }}>
            {briefNarrative}
          </p>

          {/* Metrics strip */}
          {theNumber && (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              marginBottom: briefFocus ? 14 : 0,
            }}>
              {theNumber.attainment_pct != null && (
                <span style={metricBadge()}>
                  {theNumber.attainment_pct.toFixed(0)}% attainment
                </span>
              )}
              {theNumber.coverage_ratio != null && (
                <span style={metricBadge()}>
                  {theNumber.coverage_ratio.toFixed(1)}x coverage
                </span>
              )}
              {theNumber.gap != null && theNumber.gap > 0 && (
                <span style={metricBadge(colors.yellow as string)}>
                  {formatCurrencyShort(theNumber.gap)} gap
                </span>
              )}
              {theNumber.days_remaining != null && (
                <span style={metricBadge()}>
                  {theNumber.days_remaining}d remaining
                </span>
              )}
            </div>
          )}
          
          {/* Prior Document Comparison */}
          {brief?.comparison_data && (
            <ComparisonBlock comparison={brief.comparison_data} />
          )}

          {/* Live change signal (compact — replaces delta_alert collapsible) */}
          {hasLiveDelta && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 0',
              marginBottom: briefFocus ? 0 : 0,
            }}>
              <span style={{
                fontFamily: fonts.sans,
                fontSize: 12,
                color: colors.yellow,
                fontWeight: 500,
              }}>
                ↑ {deltas!.new_critical_count > 0
                  ? `${deltas!.new_critical_count} new issue${deltas!.new_critical_count > 1 ? 's' : ''} ${deltas!.since_label.toLowerCase()}`
                  : `${deltas!.total_at_risk} deal${(deltas!.total_at_risk ?? 0) > 1 ? 's' : ''} at risk ${deltas!.since_label.toLowerCase()}`}
              </span>
              {deltas!.improved_count > 0 && (
                <span style={{
                  fontSize: 11,
                  color: colors.green,
                  background: colors.greenSoft,
                  padding: '1px 7px',
                  borderRadius: 10,
                  fontFamily: fonts.sans,
                  fontWeight: 500,
                }}>
                  ✓ {deltas!.improved_count} resolved
                </span>
              )}
              <button
                onClick={() => navigate('/investigation/history')}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  fontSize: 11, color: colors.textMuted, cursor: 'pointer',
                  fontFamily: fonts.sans, textDecoration: 'underline',
                  textUnderlineOffset: 2,
                }}
              >
                details
              </button>
            </div>
          )}

          {/* Focus block */}
          {briefFocus && (
            <div style={{
              marginTop: 12,
              padding: '10px 14px',
              borderLeft: `3px solid ${colors.accent}`,
              background: colors.surfaceRaised,
              borderRadius: '0 6px 6px 0',
            }}>
              <div style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.07em',
                color: colors.accent,
                fontFamily: fonts.sans,
                marginBottom: 5,
              }}>
                {brief?.brief_type === 'pulse' ? 'Key action' : 'Focus this week'}
              </div>
              <p style={{
                fontFamily: fonts.sans,
                fontSize: 13,
                lineHeight: 1.6,
                color: colors.text,
                margin: 0,
              }}>
                {briefFocus}
              </p>
            </div>
          )}
        </div>
      ) : (
        /* ── Fallback: original state_summary bar when no brief narrative ── */
        (typedContext || true) && (
          <div
            onClick={() => navigate('/investigation/history')}
            style={{
              padding: '8px 12px',
              borderLeft: `3px solid ${severityColor}`,
              background: colors.surfaceRaised,
              borderRadius: '0 6px 6px 0',
              marginBottom: 20,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <p style={{
              fontFamily: fonts.sans,
              fontSize: 13,
              fontWeight: 400,
              lineHeight: 1.6,
              color: colors.textSecondary,
              margin: 0,
              flex: 1,
            }}>
              {typedContext ?? greeting.state_summary}
              {cursorTarget === 'context' && <span style={CURSOR_STYLE} />}
            </p>
            <span style={{ fontSize: 12, color: colors.textMuted, flexShrink: 0 }}>→</span>
          </div>
        )
      )}

      {/* ── Delta alert (only shown when no brief narrative — fallback path) ── */}
      {!briefNarrative && briefing?.deltas && (briefing.deltas.new_critical_count > 0 || (briefing.deltas.total_at_risk ?? 0) > 0) && (
        <div
          style={{
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderLeft: `3px solid ${colors.yellow}`,
            borderRadius: '0 6px 6px 0',
            marginBottom: 12,
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
          onClick={() => navigate('/investigation/history')}
        >
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }}>
            <span style={{ fontFamily: fonts.sans, fontSize: 13, fontWeight: 600, color: colors.text }}>
              {briefing.deltas.new_critical_count > 0
                ? `↑ ${briefing.deltas.new_critical_count} new issue${briefing.deltas.new_critical_count > 1 ? 's' : ''} ${briefing.deltas.since_label.toLowerCase()}`
                : `↑ ${briefing.deltas.total_at_risk} deal${(briefing.deltas.total_at_risk ?? 0) > 1 ? 's' : ''} at risk ${briefing.deltas.since_label.toLowerCase()}`
              }
            </span>
            {briefing.deltas.improved_count > 0 && (
              <span style={{
                fontSize: 11, color: colors.green, background: colors.greenSoft,
                padding: '1px 7px', borderRadius: 10, fontFamily: fonts.sans, fontWeight: 500,
              }}>
                ✓ {briefing.deltas.improved_count} resolved
              </span>
            )}
          </div>
          <span style={{ fontSize: 12, color: colors.textMuted, flexShrink: 0 }}>→</span>
        </div>
      )}

      {/* ── Top Finding Card — de-emphasized when brief narrative is present ── */}
      {briefing?.top_finding && (
        <div
          onClick={() => navigate('/investigation/history')}
          style={{
            padding: briefNarrative ? '8px 12px' : '12px 14px',
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderLeft: `3px solid ${briefing.top_finding.severity === 'critical' ? colors.red : colors.yellow}`,
            borderRadius: '0 8px 8px 0',
            marginBottom: 20,
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: briefNarrative ? 0 : 4 }}>
                <h3 style={{
                  fontFamily: fonts.sans,
                  fontSize: briefNarrative ? 12 : 14,
                  fontWeight: 600,
                  lineHeight: 1.4,
                  margin: 0,
                  color: briefNarrative ? colors.textSecondary : colors.text,
                }}>
                  {formatFindingHeadline(briefing.top_finding.headline)}
                </h3>
                {briefing.top_finding.category?.includes('auto-investigation') && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: colors.yellow, background: colors.yellowSoft,
                    padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                  }}>
                    NEW
                  </span>
                )}
              </div>
              {!briefNarrative && briefing.top_finding.entity && (
                <p style={{
                  fontFamily: fonts.sans, fontSize: 12, color: colors.textMuted, margin: 0, lineHeight: 1.5,
                }}>
                  {briefing.top_finding.entity}
                  {briefing.top_finding.amount && ` · ${formatCurrency(briefing.top_finding.amount)}`}
                </p>
              )}
            </div>
            <span style={{
              fontSize: 11, color: colors.textMuted, flexShrink: 0, whiteSpace: 'nowrap', marginTop: 2,
            }}>
              See all findings →
            </span>
          </div>
        </div>
      )}

      {/* ── Suggested Investigations ── */}
      {briefing && briefing.investigation_paths.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p style={{
            fontFamily: fonts.sans, fontSize: 10, fontWeight: 600, margin: '0 0 10px 0',
            textTransform: 'uppercase', letterSpacing: '0.08em', color: colors.textMuted,
          }}>
            Suggested Investigations
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {briefing.investigation_paths.map((path, index) => {
              const status = investigationStatus?.get(path.skill_id || '');
              const dot = getPriorityDot(path.priority);
              const isRunning = status?.status === 'running' || status?.status === 'pending';
              const isCompleted = status?.status === 'completed';
              const isFailed = status?.status === 'failed';

              let actionLabel = 'Run →';
              let actionColor: string = colors.accent;
              if (isRunning) { actionLabel = 'Running…'; actionColor = '#eab308'; }
              else if (isCompleted) { actionLabel = 'View results →'; actionColor = '#22c55e'; }
              else if (isFailed) { actionLabel = 'Failed'; actionColor = '#ef4444'; }

              return (
                <button
                  key={index}
                  onClick={() => {
                    if (isCompleted && status?.runId) {
                      setResultsModal({ skillId: path.skill_id!, runId: status.runId });
                    } else if (!isRunning && !isFailed) {
                      onInvestigatePath(path);
                    }
                  }}
                  disabled={isRunning || isFailed}
                  style={{
                    padding: '10px 12px',
                    background: colors.surfaceRaised,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                    cursor: isRunning || isFailed ? 'default' : 'pointer',
                    textAlign: 'left',
                    width: '100%',
                    opacity: isFailed ? 0.5 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{
                      width: 7, height: 7, borderRadius: '50%', background: dot.color,
                      marginTop: 5, flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: fonts.sans, fontSize: 13, fontWeight: 500, lineHeight: 1.4,
                        color: colors.text, marginBottom: path.reasoning ? 3 : 0,
                      }}>
                        {path.question}
                      </div>
                      {path.reasoning && (
                        <div style={{
                          fontFamily: fonts.sans, fontSize: 11, fontStyle: 'italic',
                          color: colors.textMuted, lineHeight: 1.4,
                        }}>
                          {path.reasoning}
                          {!status && path.last_run_at && ` · Last run ${formatLastRunTime(path.last_run_at)}`}
                        </div>
                      )}
                    </div>
                    <span style={{
                      fontFamily: fonts.sans, fontSize: 11, fontWeight: 600, color: actionColor,
                      flexShrink: 0, animation: isRunning ? 'pandora-pulse 1.5s ease-in-out infinite' : 'none',
                      whiteSpace: 'nowrap',
                    }}>
                      {actionLabel}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              onClick={() => navigate('/investigation/history')}
              style={{
                background: 'none', border: 'none', padding: 0,
                color: colors.accent, fontSize: 12, cursor: 'pointer',
                fontFamily: fonts.sans, opacity: 0.75,
                display: 'flex', alignItems: 'center', gap: 4,
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.75')}
            >
              ↗ View full history
            </button>
          </div>
        </div>
      )}

      {/* ── Escalation Warning ── */}
      {briefing?.can_escalate && briefing.escalation_path && (
        <div style={{
          padding: '12px 14px', background: colors.bg, border: `1px solid ${colors.border}`,
          borderLeft: `3px solid ${colors.red}`, borderRadius: '0 8px 8px 0', marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <h3 style={{
                fontFamily: fonts.sans, fontWeight: 600, lineHeight: 1.4, margin: '0 0 4px 0',
                color: colors.red, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 10,
              } as React.CSSProperties}>
                Escalation Recommended
              </h3>
              <p style={{ fontFamily: fonts.sans, fontSize: 13, lineHeight: 1.5, margin: '0 0 10px 0', color: colors.text }}>
                {briefing.escalation_path}
              </p>
              {onEscalate && (
                <button
                  onClick={onEscalate}
                  style={{
                    padding: '6px 14px', background: 'transparent', color: colors.red,
                    border: `1px solid ${colors.red}`, borderRadius: 6, cursor: 'pointer',
                    fontFamily: fonts.sans, fontSize: 12, fontWeight: 600,
                  }}
                >
                  Alert Executive Team
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Question Pills ── */}
      {(greeting.questions ?? []).length > 0 && (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(greeting.questions ?? []).slice(0, 4).map((question, index) => (
              <button
                key={index}
                onClick={() => onQuestionClick ? onQuestionClick(question) : onAskPandora()}
                style={{
                  padding: '6px 10px', background: colors.surfaceRaised, border: `1px solid ${colors.border}`,
                  borderRadius: 20, cursor: 'pointer', fontFamily: fonts.sans, fontSize: 11,
                  color: colors.textSecondary, transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = colors.accent as string;
                  e.currentTarget.style.color = colors.accent as string;
                  e.currentTarget.style.background = colors.accentSoft as string;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = colors.border as string;
                  e.currentTarget.style.color = colors.textSecondary as string;
                  e.currentTarget.style.background = colors.surfaceRaised as string;
                }}
              >
                {shortenQuestion(question)}
              </button>
            ))}
          </div>
        </div>
      )}

      </>}

      {resultsModal && (
        <InvestigationResults
          skillId={resultsModal.skillId}
          runId={resultsModal.runId}
          onClose={() => setResultsModal(null)}
        />
      )}
    </div>
  );
}

function metricBadge(color?: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 9px',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 500,
    fontFamily: fonts.sans,
    background: colors.surfaceRaised,
    border: `1px solid ${colors.border}`,
    color: color ?? (colors.textSecondary as string),
    whiteSpace: 'nowrap' as const,
  };
}
