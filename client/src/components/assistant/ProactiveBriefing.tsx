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
    case 'urgent':
      return colors.red;
    case 'attention':
      return colors.yellow;
    default:
      return colors.green;
  }
}

function getSeverityIcon(severity: 'calm' | 'attention' | 'urgent'): string {
  switch (severity) {
    case 'urgent':
      return '🔴';
    case 'attention':
      return '🟡';
    default:
      return '🟢';
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
  const [expandedPath, setExpandedPath] = useState<number | null>(null);
  const [hoveredPath, setHoveredPath] = useState<number | null>(null);
  const [hoveredQuestion, setHoveredQuestion] = useState<number | null>(null);
  const [resultsModal, setResultsModal] = useState<{ skillId: string; runId: string } | null>(null);
  const navigate = useNavigate();
  const briefing = greeting.proactive_briefing;
  const isStreaming = phase && !['pills', 'browsing'].includes(phase);

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        padding: 24,
        maxWidth: 800,
        margin: '0 auto',
      }}
    >
      <style>{`@keyframes pandora-blink { 50% { opacity: 0; } }`}</style>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, color: colors.textSecondary }}>
              {getSeverityIcon(greeting.severity)} VP RevOps Brief
            </span>
            <span
              style={{
                fontSize: 12,
                color: colors.textMuted,
                padding: '2px 8px',
                background: colors.surfaceRaised,
                borderRadius: 4,
              }}
            >
              {greeting.recency_label}
            </span>
          </div>
          {greeting.week_context && (
            <div style={{ fontSize: 12, color: colors.textMuted }}>
              {greeting.week_context}
            </div>
          )}
        </div>
      </div>

      {/* Greeting */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{
          fontFamily: fonts.sans,
          fontSize: 22,
          fontWeight: 700,
          lineHeight: 1.3,
          margin: '0 0 8px 0',
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

      {/* State Summary */}
      {(typedContext || !isStreaming) && (
        <div
          style={{
            padding: '4px 0 4px 12px',
            borderLeft: `3px solid ${getSeverityColor(greeting.severity)}`,
            marginBottom: 20,
          }}
        >
          <p style={{
            fontFamily: fonts.sans,
            fontSize: 13,
            fontWeight: 400,
            lineHeight: 1.6,
            color: colors.textSecondary,
            margin: 0,
          }}>
            {typedContext ?? greeting.state_summary}
            {cursorTarget === 'context' && <span style={CURSOR_STYLE} />}
          </p>
        </div>
      )}

      {!isStreaming && <>

      {/* Delta Alert */}
      {briefing?.deltas && (briefing.deltas.new_critical_count > 0 || (briefing.deltas.total_at_risk ?? 0) > 0) && (
        <div
          style={{
            padding: 12,
            background: 'rgba(251, 191, 36, 0.1)',
            border: `1px solid ${colors.yellow}`,
            borderRadius: 8,
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 16 }}>{briefing.deltas.new_critical_count > 0 ? '🆕' : '⚠️'}</span>
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: fonts.sans,
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.4,
              color: colors.text,
            }}>
              {briefing.deltas.new_critical_count > 0
                ? `${briefing.deltas.new_critical_count} new issue${briefing.deltas.new_critical_count > 1 ? 's' : ''} detected ${briefing.deltas.since_label.toLowerCase()}`
                : `${briefing.deltas.total_at_risk} deal${(briefing.deltas.total_at_risk ?? 0) > 1 ? 's' : ''} at risk ${briefing.deltas.since_label.toLowerCase()}`
              }
            </div>
            {briefing.deltas.improved_count > 0 && (
              <div style={{
                fontFamily: fonts.sans,
                fontSize: 12,
                fontWeight: 400,
                lineHeight: 1.5,
                color: colors.textMuted,
                marginTop: 2,
              }}>
                ✅ {briefing.deltas.improved_count} issue{briefing.deltas.improved_count > 1 ? 's' : ''} resolved
              </div>
            )}
          </div>
        </div>
      )}

      {/* Top Finding Card */}
      {briefing?.top_finding && (
        <div
          style={{
            padding: 16,
            background:
              briefing.top_finding.severity === 'critical'
                ? 'rgba(239, 68, 68, 0.1)'
                : 'rgba(251, 191, 36, 0.1)',
            border: `1px solid ${
              briefing.top_finding.severity === 'critical' ? colors.red : colors.yellow
            }`,
            borderRadius: 8,
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontSize: 18 }}>
              {briefing.top_finding.severity === 'critical' ? '🔴' : '🟡'}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{
                  fontFamily: fonts.sans,
                  fontSize: 14,
                  fontWeight: 600,
                  lineHeight: 1.4,
                  margin: '0 0 4px 0'
                }}>
                  {formatFindingHeadline(briefing.top_finding.headline)}
                </h3>
                {briefing.top_finding.category?.includes('auto-investigation') && (
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: colors.yellow,
                    background: 'rgba(251, 191, 36, 0.2)',
                    padding: '2px 6px',
                    borderRadius: 4,
                  }}>
                    NEW
                  </span>
                )}
              </div>
              {briefing.top_finding.entity && (
                <p style={{
                  fontFamily: fonts.sans,
                  fontSize: 12,
                  fontWeight: 400,
                  lineHeight: 1.5,
                  color: colors.textMuted,
                  margin: 0
                }}>
                  {briefing.top_finding.entity}
                  {briefing.top_finding.amount && ` · ${formatCurrency(briefing.top_finding.amount)}`}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Investigation Paths */}
      {briefing && briefing.investigation_paths.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p style={{
            fontFamily: fonts.sans,
            fontSize: 10,
            fontWeight: 600,
            lineHeight: 1.4,
            margin: '0 0 10px 0',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: colors.textMuted,
          }}>
            {briefing.investigation_title}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {briefing.investigation_paths.map((path, index) => {
              const isHovered = hoveredPath === index;
              const status = investigationStatus?.get(path.skill_id || '');
              const borderColor = path.priority === 'high'
                ? colors.red
                : path.priority === 'medium'
                ? colors.yellow
                : colors.border;

              return (
                <button
                  key={index}
                  onClick={() => {
                    console.log('[ProactiveBriefing] Investigation path clicked:', path.question);
                    console.log('[ProactiveBriefing] Current status:', status);

                    // If completed, show results modal
                    if (status?.status === 'completed' && status.runId) {
                      console.log('[ProactiveBriefing] Showing results modal');
                      setResultsModal({ skillId: path.skill_id!, runId: status.runId });
                    }
                    // If running, just toggle expand to see progress
                    else if (status?.status === 'running') {
                      console.log('[ProactiveBriefing] Toggling expand while running');
                      setExpandedPath(expandedPath === index ? null : index);
                    }
                    // If not started, trigger investigation and auto-expand
                    else {
                      console.log('[ProactiveBriefing] Triggering investigation');
                      onInvestigatePath(path);
                      setExpandedPath(index);
                    }
                  }}
                  onMouseEnter={() => setHoveredPath(index)}
                  onMouseLeave={() => setHoveredPath(null)}
                  disabled={false}
                  style={{
                    padding: 12,
                    background: isHovered ? colors.surface : colors.surfaceRaised,
                    border: `1px solid ${isHovered ? colors.accent : borderColor}`,
                    borderRadius: 8,
                    cursor: status?.status === 'running' ? 'wait' : 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.2s',
                    opacity: status?.status === 'running' ? 0.7 : 1,
                  }}
                >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>
                    {status?.status === 'running' ? '⏳' :
                     status?.status === 'completed' ? '✅' :
                     status?.status === 'failed' ? '❌' :
                     path.priority === 'high' ? '⚡' : '💡'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontFamily: fonts.sans,
                      fontSize: 14,
                      fontWeight: 500,
                      lineHeight: 1.5
                    }}>
                      {path.question}
                    </div>
                    {expandedPath === index && (
                      <div
                        style={{
                          fontFamily: fonts.sans,
                          fontSize: 12,
                          fontWeight: 400,
                          lineHeight: 1.5,
                          color: colors.textMuted,
                          marginTop: 4,
                        }}
                      >
                        {path.reasoning}
                        {path.skill_id && ` · Uses ${path.skill_id}`}
                        {status?.status === 'running' && ' · Investigating...'}
                        {status?.status === 'completed' && ' · Ready to view'}
                        {status?.status === 'failed' && ` · Failed: ${status.error}`}
                        {!status && path.last_run_at && (
                          <span style={{ color: colors.textMuted }}>
                            {' · Last run: '}{formatLastRunTime(path.last_run_at)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: colors.textMuted }}>
                    {expandedPath === index ? '▲' : '▼'}
                  </span>
                </div>
              </button>
              );
            })}
          </div>
          <p
            style={{
              fontFamily: fonts.sans,
              fontSize: 12,
              fontWeight: 400,
              lineHeight: 1.5,
              color: colors.textMuted,
              marginTop: 8,
              textAlign: 'center',
            }}
          >
            Click to investigate · Results appear here when ready
          </p>
          <div style={{ textAlign: 'right', marginTop: 4 }}>
            <button
              onClick={() => navigate('/investigation/history')}
              style={{
                background: 'none', border: 'none', padding: 0,
                color: colors.accent, fontSize: 11, cursor: 'pointer',
                fontFamily: fonts.sans, opacity: 0.8,
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.8')}
            >
              View full history →
            </button>
          </div>
        </div>
      )}

      {/* Escalation Warning */}
      {briefing?.can_escalate && briefing.escalation_path && (
        <div
          style={{
            padding: 16,
            background: 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${colors.red}`,
            borderRadius: 8,
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <h3 style={{
                fontFamily: fonts.sans,
                fontSize: 16,
                fontWeight: 600,
                lineHeight: 1.4,
                margin: '0 0 4px 0',
                color: colors.red
              }}>
                Escalation Recommended
              </h3>
              <p style={{
                fontFamily: fonts.sans,
                fontSize: 14,
                fontWeight: 400,
                lineHeight: 1.5,
                margin: '0 0 12px 0'
              }}>
                {briefing.escalation_path}
              </p>
              {onEscalate && (
                <button
                  onClick={onEscalate}
                  style={{
                    padding: '8px 16px',
                    background: colors.red,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontFamily: fonts.sans,
                    fontSize: 14,
                    fontWeight: 600,
                    lineHeight: 1.5,
                  }}
                >
                  Alert Executive Team
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Suggested Questions */}
      <div style={{ marginBottom: 20 }}>
        <p style={{
          fontFamily: fonts.sans,
          fontSize: 10,
          fontWeight: 600,
          lineHeight: 1.4,
          margin: '0 0 8px 0',
          color: colors.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          Or ask me anything
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(greeting.questions ?? []).slice(0, 4).map((question, index) => {
            const isHovered = hoveredQuestion === index;
            return (
              <button
                key={index}
                onClick={() => onQuestionClick ? onQuestionClick(question) : onAskPandora()}
                onMouseEnter={() => setHoveredQuestion(index)}
                onMouseLeave={() => setHoveredQuestion(null)}
                style={{
                  padding: '8px 12px',
                  background: isHovered ? colors.surface : colors.surfaceRaised,
                  border: `1px solid ${isHovered ? colors.accent : colors.border}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontFamily: fonts.sans,
                  fontSize: 12,
                  fontWeight: 400,
                  lineHeight: 1.5,
                  color: isHovered ? colors.accent : colors.textSecondary,
                  transition: 'all 0.2s',
                }}
              >
                {question}
              </button>
            );
          })}
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button
          onClick={() => navigate('/investigation/history')}
          style={{
            padding: '10px 20px',
            background: colors.surface,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            cursor: 'pointer',
            fontFamily: fonts.sans,
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.5,
          }}
        >
          View History
        </button>
        <button
          onClick={onAskPandora}
          style={{
            padding: '10px 20px',
            background: colors.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontFamily: fonts.sans,
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.5,
          }}
        >
          Ask Pandora
        </button>
      </div>

      </>}

      {/* Investigation Results Modal */}
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
