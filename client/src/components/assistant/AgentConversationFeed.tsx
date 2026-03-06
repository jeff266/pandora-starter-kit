import React, { useState, useEffect, useRef } from 'react';
import { colors, fonts } from '../../styles/theme';
import type { OperatorProgress } from './AgentChip';

export interface ToolCallEvent {
  agent_id: string;
  tool_name: string;
  label: string;
  ts: number;
}

interface FeedLine {
  id: string;
  kind: 'status' | 'tool' | 'finding' | 'done';
  text: string;
  ts: number;
}

const TOOL_LABELS: Record<string, string> = {
  query_deals: 'Scanning deals',
  query_accounts: 'Looking up accounts',
  query_contacts: 'Checking contacts',
  compute_metric: 'Computing metric',
  query_pipeline_by_stage: 'Scanning pipeline by stage',
  get_skill_evidence: 'Retrieving analysis',
  query_conversations: 'Checking call transcripts',
  search_transcripts: 'Searching call recordings',
  query_activities: 'Reviewing activities',
  query_forecasts: 'Pulling forecast data',
  get_forecast_rollup: 'Loading forecast rollup',
  compute_coverage: 'Computing pipeline coverage',
  compute_attainment: 'Computing attainment',
  query_schema: 'Inspecting data schema',
};

function humanLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

interface AgentCardProps {
  operator: OperatorProgress;
  toolCalls: ToolCallEvent[];
  onClick?: () => void;
}

function AgentCard({ operator, toolCalls, onClick }: AgentCardProps) {
  const { agent_id, agent_name, icon, color, phase, finding_preview } = operator;
  const isClickable = !!onClick && phase === 'done';

  const myToolCalls = toolCalls.filter(t => t.agent_id === agent_id);

  const lines: FeedLine[] = [];

  if (phase === 'recruiting') {
    lines.push({ id: 'r', kind: 'status', text: 'Standing by...', ts: 0 });
  } else if (phase === 'thinking') {
    lines.push({ id: 't', kind: 'status', text: 'Analyzing...', ts: 0 });
  }

  for (const tc of myToolCalls) {
    lines.push({ id: `tc-${tc.ts}`, kind: 'tool', text: humanLabel(tc.tool_name), ts: tc.ts });
  }

  if (phase === 'found' && finding_preview) {
    lines.push({ id: 'found', kind: 'finding', text: finding_preview, ts: Date.now() });
  }

  if (phase === 'done' && finding_preview) {
    lines.push({ id: 'done', kind: 'done', text: finding_preview, ts: Date.now() });
  }

  const borderColor = phase === 'recruiting' ? colors.border
    : phase === 'thinking' ? color
    : phase === 'found' ? color
    : '#34D399';

  return (
    <div
      onClick={isClickable ? onClick : undefined}
      style={{
        borderLeft: `3px solid ${borderColor}`,
        background: colors.surfaceRaised,
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
        borderLeftWidth: 3,
        overflow: 'hidden',
        transition: 'border-color 0.3s',
        cursor: isClickable ? 'pointer' : 'default',
        minWidth: 200,
        maxWidth: 320,
        flex: '1 1 200px',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px',
        borderBottom: lines.length > 0 ? `1px solid ${colors.border}` : 'none',
      }}>
        <span style={{ fontSize: 15, flexShrink: 0 }}>{icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: colors.text, flex: 1, fontFamily: fonts.sans }}>{agent_name}</span>
        {phase === 'thinking' && <PulsingDots color={color} />}
        {phase === 'found' && <span style={{ fontSize: 11, color: color }}>●</span>}
        {phase === 'done' && <span style={{ fontSize: 12, color: '#34D399' }}>✓</span>}
        {isClickable && <span style={{ fontSize: 10, color: colors.accent, fontWeight: 400 }}>View →</span>}
      </div>

      {lines.length > 0 && (
        <div style={{ padding: '6px 12px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {lines.map((line, i) => (
            <FeedItem key={line.id} line={line} color={color} delay={i * 60} />
          ))}
        </div>
      )}
    </div>
  );
}

function FeedItem({ line, color, delay }: { line: FeedLine; color: string; delay: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  const icon = line.kind === 'tool' ? '🔍'
    : line.kind === 'finding' ? '◎'
    : line.kind === 'done' ? '✓'
    : '·';

  const textColor = line.kind === 'done' ? '#34D399'
    : line.kind === 'finding' ? color
    : line.kind === 'tool' ? colors.textSecondary
    : colors.textMuted;

  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 5,
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(4px)',
      transition: 'opacity 0.25s ease, transform 0.25s ease',
      fontSize: 10,
      fontFamily: fonts.sans,
    }}>
      <span style={{ color: textColor, flexShrink: 0, fontSize: 9, minWidth: 10 }}>{icon}</span>
      <span style={{ color: textColor, lineHeight: 1.4 }}>{line.text}</span>
    </div>
  );
}

function PulsingDots({ color }: { color: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 3, height: 3, borderRadius: '50%', background: color,
          display: 'inline-block',
          animation: `pulse-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
      <style>{`
        @keyframes pulse-dot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>
    </span>
  );
}

interface AgentConversationFeedProps {
  operators: OperatorProgress[];
  toolCalls: ToolCallEvent[];
  phase: string;
  onOperatorClick?: (agentId: string) => void;
}

const AGENT_ROUTES: Record<string, string> = {
  'forecast-rollup': '/forecast',
  'forecast-call-prep': '/forecast',
  'attainment-vs-goal': '/forecast',
  'monte-carlo-forecast': '/forecast',
  'pipeline-state': '/command-center',
  'pipeline-coverage': '/command-center',
  'bowtie-review': '/command-center',
};

export default function AgentConversationFeed({ operators, toolCalls, phase, onOperatorClick }: AgentConversationFeedProps) {
  const [collapsed, setCollapsed] = useState(false);
  const prevPhaseRef = useRef(phase);

  useEffect(() => {
    if (prevPhaseRef.current !== 'complete' && phase === 'complete') {
      const t = setTimeout(() => setCollapsed(true), 2200);
      return () => clearTimeout(t);
    }
    prevPhaseRef.current = phase;
  }, [phase]);

  if (operators.length === 0) return null;

  if (collapsed) {
    const doneCount = operators.filter(o => o.phase === 'done').length;
    return (
      <div
        onClick={() => setCollapsed(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px',
          background: colors.surfaceRaised,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          cursor: 'pointer',
          fontSize: 11,
          fontFamily: fonts.sans,
          color: colors.textSecondary,
          marginBottom: 12,
        }}
      >
        <span style={{ display: 'flex', gap: 4 }}>
          {operators.slice(0, 4).map(op => (
            <span key={op.agent_id} style={{ fontSize: 13 }}>{op.icon}</span>
          ))}
        </span>
        <span>Consulted {doneCount} analyst{doneCount !== 1 ? 's' : ''}</span>
        <span style={{ color: colors.accent, marginLeft: 'auto' }}>Expand ↓</span>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: fonts.sans }}>
          Consulting Operators
        </div>
        {phase === 'complete' && (
          <span
            onClick={() => setCollapsed(true)}
            style={{ fontSize: 10, color: colors.textMuted, cursor: 'pointer', fontFamily: fonts.sans }}
          >
            Collapse ↑
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {operators.map(op => {
          const route = AGENT_ROUTES[op.agent_id];
          return (
            <AgentCard
              key={op.agent_id}
              operator={op}
              toolCalls={toolCalls}
              onClick={route && onOperatorClick ? () => onOperatorClick(op.agent_id) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
