import React from 'react';
import { colors } from '../../styles/theme';

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

export interface ProactiveBriefing {
  mode: 'investigation_ready' | 'none';
  investigation_title: string;
  findings_count: number;
  top_finding?: TopFinding;
  investigation_paths: InvestigationPath[];
  can_escalate: boolean;
  escalation_path?: string;
}

export interface GreetingPayload {
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
  proactive_briefing?: ProactiveBriefing;
}

export type GreetingPhase = 'blank' | 'headline' | 'subline' | 'context' | 'questions' | 'pills' | 'browsing';

interface GreetingProps {
  data?: GreetingPayload;
  phase: GreetingPhase;
  typedHeadline: string;
  typedSubline: string;
  typedContext: string;
  visibleQuestions: number;
  cursorTarget: 'headline' | 'subline' | 'context' | null;
}

const SEVERITY_COLOR: Record<string, string> = {
  calm: '#48af9b',
  attention: '#FBBF24',
  urgent: '#ff8c82',
};

const CURSOR_STYLE: React.CSSProperties = {
  display: 'inline-block',
  width: 2,
  height: '1em',
  background: '#48af9b',
  marginLeft: 2,
  verticalAlign: 'text-bottom',
  animation: 'pandora-blink 0.7s step-end infinite',
};

export default function Greeting({
  data,
  phase,
  typedHeadline,
  typedSubline,
  typedContext,
  visibleQuestions,
  cursorTarget,
}: GreetingProps) {
  const sevColor = data ? (SEVERITY_COLOR[data.severity] ?? colors.accent) : colors.accent;
  const { critical_count = 0, warning_count = 0 } = data?.metrics ?? {};
  const sevLabel = critical_count > 0
    ? `${critical_count} critical${warning_count > 0 ? ` · ${warning_count} warning${warning_count !== 1 ? 's' : ''}` : ''}`
    : warning_count > 0
      ? `${warning_count} warning${warning_count !== 1 ? 's' : ''}`
      : 'All clear';

  const showHeadline = phase !== 'blank';
  const showSubline = phase !== 'blank' && phase !== 'headline';
  const showContext = !['blank', 'headline', 'subline'].includes(phase);
  const showWeekContext = ['questions', 'pills', 'browsing'].includes(phase);
  const showSeverity = ['pills', 'browsing'].includes(phase);
  const questions = data?.questions ?? [];

  return (
    <>
      <style>{`
        @keyframes pandora-blink { 50% { opacity: 0; } }
        @keyframes pandora-pulse {
          0%, 100% { box-shadow: 0 0 20px rgba(72,175,155,0.3); }
          50% { box-shadow: 0 0 36px rgba(72,175,155,0.6), 0 0 60px rgba(58,127,193,0.3); }
        }
        @keyframes pandora-fade-up {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div style={{ marginBottom: 28 }}>
        <div style={{
          width: 52, height: 52, borderRadius: '50%', marginBottom: 18,
          background: 'linear-gradient(135deg, #48af9b 0%, #3a7fc1 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontWeight: 700, color: '#fff', flexShrink: 0,
          animation: 'pandora-pulse 2.5s ease-in-out infinite',
        }}>
          ✦
        </div>

        {showHeadline && (
          <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.text, margin: '0 0 6px 0', lineHeight: 1.25, minHeight: '1.25em' }}>
            {typedHeadline}
            {cursorTarget === 'headline' && <span style={CURSOR_STYLE} />}
          </h1>
        )}

        {showSubline && typedSubline && (
          <p style={{ fontSize: 14, color: colors.textMuted, margin: '0 0 10px 0', lineHeight: 1.5 }}>
            {typedSubline}
            {cursorTarget === 'subline' && <span style={CURSOR_STYLE} />}
          </p>
        )}

        {showContext && typedContext && (
          <p style={{ fontSize: 13, color: colors.textSecondary, margin: '0 0 12px 0', lineHeight: 1.6 }}>
            {typedContext}
            {cursorTarget === 'context' && <span style={CURSOR_STYLE} />}
          </p>
        )}

        {showSeverity && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, animation: 'pandora-fade-up 300ms ease-out forwards' }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: sevColor, boxShadow: `0 0 6px ${sevColor}` }} />
            <span style={{ fontSize: 12, color: sevColor, fontWeight: 500 }}>{sevLabel}</span>
          </div>
        )}

        {showWeekContext && data?.week_context && (
          <div style={{ marginBottom: 16, animation: 'pandora-fade-up 300ms ease-out forwards' }}>
            <span style={{
              display: 'inline-block',
              fontSize: 11,
              color: colors.textMuted,
              border: `1px solid ${colors.border ?? 'rgba(255,255,255,0.1)'}`,
              borderRadius: 4,
              padding: '2px 8px',
              letterSpacing: '0.02em',
            }}>
              {data.week_context}
            </span>
          </div>
        )}

        {showWeekContext && questions.length > 0 && visibleQuestions > 0 && (
          <div style={{ marginBottom: 8 }}>
            <p style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: colors.textMuted, margin: '0 0 8px 0',
            }}>
              On your mind
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {questions.slice(0, visibleQuestions).map((q, i) => (
                <li
                  key={i}
                  style={{
                    display: 'flex', gap: 6, fontSize: 12,
                    color: colors.textSecondary, lineHeight: 1.55,
                    marginBottom: 5,
                    animation: 'pandora-fade-up 280ms ease-out forwards',
                  }}
                >
                  <span style={{ color: colors.textMuted, flexShrink: 0 }}>›</span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
