import React, { useState } from 'react';
import { colors, fonts } from '../../styles/theme';
import InvestigationResults from './InvestigationResults';

export interface InvestigationPath {
  question: string;
  reasoning: string;
  skill_id?: string;
  priority: 'high' | 'medium' | 'low';
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
}

export interface GreetingData {
  headline: string;
  subline: string;
  state_summary: string;
  recency_label: string;
  severity: 'calm' | 'attention' | 'urgent';
  week_context: string;
  questions: string[];
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
  onInvestigatePath: (path: InvestigationPath) => void;
  onEscalate?: () => void;
  onAskPandora: () => void;
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
  onInvestigatePath,
  onEscalate,
  onAskPandora,
  investigationStatus,
}: ProactiveBriefingProps) {
  const [expandedPath, setExpandedPath] = useState<number | null>(null);
  const [hoveredPath, setHoveredPath] = useState<number | null>(null);
  const [hoveredQuestion, setHoveredQuestion] = useState<number | null>(null);
  const [resultsModal, setResultsModal] = useState<{ skillId: string; runId: string } | null>(null);
  const briefing = greeting.proactive_briefing;

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
          margin: '0 0 8px 0'
        }}>{greeting.headline}</h2>
        <p style={{
          fontFamily: fonts.sans,
          fontSize: 14,
          fontWeight: 400,
          lineHeight: 1.5,
          color: colors.textSecondary,
          margin: 0
        }}>
          {greeting.subline}
        </p>
      </div>

      {/* State Summary */}
      <div
        style={{
          padding: 16,
          background: colors.surfaceRaised,
          borderRadius: 8,
          borderLeft: `4px solid ${getSeverityColor(greeting.severity)}`,
          marginBottom: 20,
        }}
      >
        <p style={{
          fontFamily: fonts.sans,
          fontSize: 14,
          fontWeight: 400,
          lineHeight: 1.5,
          margin: 0
        }}>{greeting.state_summary}</p>
      </div>

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
              <h3 style={{
                fontFamily: fonts.sans,
                fontSize: 16,
                fontWeight: 600,
                lineHeight: 1.4,
                margin: '0 0 4px 0'
              }}>
                {briefing.top_finding.headline}
              </h3>
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
          <h3 style={{
            fontFamily: fonts.sans,
            fontSize: 16,
            fontWeight: 600,
            lineHeight: 1.4,
            margin: '0 0 12px 0'
          }}>
            {briefing.investigation_title}
          </h3>
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
                    // If completed, show results modal
                    if (status?.status === 'completed' && status.runId) {
                      setResultsModal({ skillId: path.skill_id!, runId: status.runId });
                    } else {
                      // Otherwise just expand/collapse
                      setExpandedPath(expandedPath === index ? null : index);
                    }
                  }}
                  onDoubleClick={() => {
                    // Don't allow double-click if already running
                    if (status?.status !== 'running') {
                      onInvestigatePath(path);
                    }
                  }}
                  onMouseEnter={() => setHoveredPath(index)}
                  onMouseLeave={() => setHoveredPath(null)}
                  disabled={status?.status === 'running'}
                  style={{
                    padding: 12,
                    background: isHovered ? colors.surface : colors.surfaceRaised,
                    border: `1px solid ${isHovered ? colors.accent : borderColor}`,
                    borderRadius: 8,
                    cursor: status?.status === 'running' ? 'wait' : status?.status === 'completed' ? 'pointer' : 'pointer',
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
            Click to expand · Double-click to investigate
          </p>
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
        <h3 style={{
          fontFamily: fonts.sans,
          fontSize: 16,
          fontWeight: 600,
          lineHeight: 1.4,
          margin: '0 0 12px 0',
          color: colors.textMuted
        }}>
          Or ask me anything:
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {greeting.questions.slice(0, 4).map((question, index) => {
            const isHovered = hoveredQuestion === index;
            return (
              <button
                key={index}
                onClick={() => onAskPandora()}
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
