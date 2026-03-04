import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../../styles/theme';
import InvestigationResults from './InvestigationResults';
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
}: ProactiveBriefingProps) {
  const navigate = useNavigate();
  const [resultsModal, setResultsModal] = useState<{ skillId: string; runId: string } | null>(null);
  const [deltaExpanded, setDeltaExpanded] = useState(false);
  const briefing = greeting.proactive_briefing;
  const isStreaming = phase && !['pills', 'browsing'].includes(phase);
  const severityColor = getSeverityColor(greeting.severity);

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

      {/* ── State Summary — clickable, navigates to history ── */}
      {(typedContext || !isStreaming) && (
        <div
          onClick={!isStreaming ? () => navigate('/investigation/history') : undefined}
          style={{
            padding: '8px 12px',
            borderLeft: `3px solid ${severityColor}`,
            background: colors.surfaceRaised,
            borderRadius: '0 6px 6px 0',
            marginBottom: 20,
            cursor: !isStreaming ? 'pointer' : 'default',
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
          {!isStreaming && (
            <span style={{ fontSize: 12, color: colors.textMuted, flexShrink: 0 }}>→</span>
          )}
        </div>
      )}

      {!isStreaming && <>

      {/* ── Delta Alert ── */}
      {briefing?.deltas && (briefing.deltas.new_critical_count > 0 || (briefing.deltas.total_at_risk ?? 0) > 0) && (
        <div
          style={{
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderLeft: `3px solid ${colors.yellow}`,
            borderRadius: '0 6px 6px 0',
            marginBottom: 12,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: (briefing.deltas.worsened_investigations?.length ?? 0) > 0 ? 'pointer' : 'default',
            }}
            onClick={() => {
              if ((briefing.deltas!.worsened_investigations?.length ?? 0) > 0) {
                setDeltaExpanded(e => !e);
              } else {
                navigate('/investigation/history');
              }
            }}
          >
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontFamily: fonts.sans,
                fontSize: 13,
                fontWeight: 600,
                color: colors.text,
              }}>
                {briefing.deltas.new_critical_count > 0
                  ? `↑ ${briefing.deltas.new_critical_count} new issue${briefing.deltas.new_critical_count > 1 ? 's' : ''} ${briefing.deltas.since_label.toLowerCase()}`
                  : `↑ ${briefing.deltas.total_at_risk} deal${(briefing.deltas.total_at_risk ?? 0) > 1 ? 's' : ''} at risk ${briefing.deltas.since_label.toLowerCase()}`
                }
              </span>
              {briefing.deltas.improved_count > 0 && (
                <span style={{
                  fontSize: 11,
                  color: colors.green,
                  background: colors.greenSoft,
                  padding: '1px 7px',
                  borderRadius: 10,
                  fontFamily: fonts.sans,
                  fontWeight: 500,
                }}>
                  ✓ {briefing.deltas.improved_count} resolved
                </span>
              )}
            </div>
            {(briefing.deltas.worsened_investigations?.length ?? 0) > 0 ? (
              <span style={{ fontSize: 11, color: colors.textMuted, flexShrink: 0 }}>
                {deltaExpanded ? '▴ Hide' : '▾ Details'}
              </span>
            ) : (
              <span style={{ fontSize: 12, color: colors.textMuted, flexShrink: 0 }}>→</span>
            )}
          </div>
          {deltaExpanded && (briefing.deltas.worsened_investigations?.length ?? 0) > 0 && (
            <div style={{
              borderTop: `1px solid ${colors.border}`,
              padding: '8px 12px 10px 16px',
            }}>
              <div style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                color: colors.textMuted,
                marginBottom: 6,
                fontFamily: fonts.sans,
              }}>
                Worsened since last check
              </div>
              <ul style={{ margin: 0, padding: '0 0 0 14px', listStyle: 'disc' }}>
                {briefing.deltas.worsened_investigations.map((name, i) => (
                  <li key={i} style={{
                    fontFamily: fonts.sans,
                    fontSize: 12,
                    color: colors.textSecondary,
                    lineHeight: 1.7,
                  }}>
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Top Finding Card — clickable, links to history ── */}
      {briefing?.top_finding && (
        <div
          onClick={() => navigate('/investigation/history')}
          style={{
            padding: '12px 14px',
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <h3 style={{
                  fontFamily: fonts.sans,
                  fontSize: 14,
                  fontWeight: 600,
                  lineHeight: 1.4,
                  margin: 0,
                }}>
                  {formatFindingHeadline(briefing.top_finding.headline)}
                </h3>
                {briefing.top_finding.category?.includes('auto-investigation') && (
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: colors.yellow,
                    background: colors.yellowSoft,
                    padding: '1px 6px',
                    borderRadius: 4,
                    flexShrink: 0,
                  }}>
                    NEW
                  </span>
                )}
              </div>
              {briefing.top_finding.entity && (
                <p style={{
                  fontFamily: fonts.sans,
                  fontSize: 12,
                  color: colors.textMuted,
                  margin: 0,
                  lineHeight: 1.5,
                }}>
                  {briefing.top_finding.entity}
                  {briefing.top_finding.amount && ` · ${formatCurrency(briefing.top_finding.amount)}`}
                </p>
              )}
            </div>
            <span style={{
              fontSize: 11,
              color: colors.textMuted,
              flexShrink: 0,
              whiteSpace: 'nowrap',
              marginTop: 2,
            }}>
              View in history →
            </span>
          </div>
        </div>
      )}

      {/* ── Suggested Investigations ── */}
      {briefing && briefing.investigation_paths.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p style={{
            fontFamily: fonts.sans,
            fontSize: 10,
            fontWeight: 600,
            margin: '0 0 10px 0',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: colors.textMuted,
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
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: dot.color,
                      marginTop: 5,
                      flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: fonts.sans,
                        fontSize: 13,
                        fontWeight: 500,
                        lineHeight: 1.4,
                        color: colors.text,
                        marginBottom: path.reasoning ? 3 : 0,
                      }}>
                        {path.question}
                      </div>
                      {path.reasoning && (
                        <div style={{
                          fontFamily: fonts.sans,
                          fontSize: 11,
                          fontStyle: 'italic',
                          color: colors.textMuted,
                          lineHeight: 1.4,
                        }}>
                          {path.reasoning}
                          {!status && path.last_run_at && ` · Last run ${formatLastRunTime(path.last_run_at)}`}
                        </div>
                      )}
                    </div>
                    <span style={{
                      fontFamily: fonts.sans,
                      fontSize: 11,
                      fontWeight: 600,
                      color: actionColor,
                      flexShrink: 0,
                      animation: isRunning ? 'pandora-pulse 1.5s ease-in-out infinite' : 'none',
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
        <div
          style={{
            padding: '12px 14px',
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderLeft: `3px solid ${colors.red}`,
            borderRadius: '0 8px 8px 0',
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <h3 style={{
                fontFamily: fonts.sans,
                fontWeight: 600,
                lineHeight: 1.4,
                margin: '0 0 4px 0',
                color: colors.red,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                fontSize: 10,
              } as React.CSSProperties}>
                Escalation Recommended
              </h3>
              <p style={{
                fontFamily: fonts.sans,
                fontSize: 13,
                lineHeight: 1.5,
                margin: '0 0 10px 0',
                color: colors.text,
              }}>
                {briefing.escalation_path}
              </p>
              {onEscalate && (
                <button
                  onClick={onEscalate}
                  style={{
                    padding: '6px 14px',
                    background: 'transparent',
                    color: colors.red,
                    border: `1px solid ${colors.red}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontFamily: fonts.sans,
                    fontSize: 12,
                    fontWeight: 600,
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
                  padding: '6px 10px',
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 20,
                  cursor: 'pointer',
                  fontFamily: fonts.sans,
                  fontSize: 11,
                  color: colors.textSecondary,
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
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

      {/* ── Investigation Results Modal ── */}
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
