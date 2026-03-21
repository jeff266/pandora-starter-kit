import React, { useState } from 'react';
import type { DeliberationBlock, DeliberationPanel } from '../../../../shared/types/response-blocks';
import { SEMANTIC_COLORS, COLOR_HINT_MAP } from '../../lib/chartColors';

const TEAL   = SEMANTIC_COLORS['advocate'];   // #14B8A6
const INDIGO = SEMANTIC_COLORS['synthesis'];  // #6366F1
const FALLBACK = SEMANTIC_COLORS['uniform'];  // #0D9488

function getPanelColor(panel: DeliberationPanel): string {
  const hint = panel.color_hint?.toLowerCase() as keyof typeof COLOR_HINT_MAP | undefined;
  if (hint && COLOR_HINT_MAP[hint]) return COLOR_HINT_MAP[hint];
  const role = panel.role.toLowerCase().trim();
  if (SEMANTIC_COLORS[role as keyof typeof SEMANTIC_COLORS]) return SEMANTIC_COLORS[role as keyof typeof SEMANTIC_COLORS] as string;
  const firstWord = role.split(/\s+/)[0] as keyof typeof SEMANTIC_COLORS;
  if (SEMANTIC_COLORS[firstWord]) return SEMANTIC_COLORS[firstWord] as string;
  return FALLBACK;
}

interface DeliberationBlockViewProps {
  block: DeliberationBlock;
}

export default function DeliberationBlockView({ block }: DeliberationBlockViewProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [hypothesisExpanded, setHypothesisExpanded] = useState(false);

  const isRedTeam    = block.mode === 'red_team';
  const pillBg       = isRedTeam ? 'rgba(249,115,22,0.15)' : 'rgba(245,158,11,0.15)';
  const pillColor    = isRedTeam ? SEMANTIC_COLORS['prosecutor'] : SEMANTIC_COLORS['bull'];
  const modeLabel    = isRedTeam ? '🔴 Red Team' : '🐂 Bull / Bear';

  return (
    <div style={{
      border: '1px solid #334155',
      borderRadius: 8,
      background: '#0f172a',
      marginBottom: 12,
      overflow: 'hidden',
      fontSize: 14,
      color: '#e2e8f0',
    }}>
      <style>{`
        .delib-panels {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          padding: 0 14px 14px;
        }
        @media (max-width: 600px) {
          .delib-panels { grid-template-columns: 1fr; }
        }
      `}</style>

      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: collapsed ? 'none' : '1px solid #1e293b',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 4,
          background: pillBg, color: pillColor, letterSpacing: '0.03em',
        }}>
          {modeLabel}
        </span>
        <span style={{
          fontSize: 13, color: '#64748b', display: 'inline-block',
          transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s ease',
        }}>
          ▾
        </span>
      </div>

      {!collapsed && (
        <div style={{ padding: '10px 14px 4px' }}>
          <div
            onClick={() => setHypothesisExpanded(e => !e)}
            style={{
              fontSize: 13, color: '#94a3b8', fontStyle: 'italic', lineHeight: 1.55,
              cursor: block.hypothesis.length > 120 ? 'pointer' : 'default',
              ...(hypothesisExpanded ? {} : {
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              } as React.CSSProperties),
            }}
          >
            {block.hypothesis}
          </div>
          {!hypothesisExpanded && block.hypothesis.length > 120 && (
            <span
              onClick={() => setHypothesisExpanded(true)}
              style={{ fontSize: 11, color: '#475569', cursor: 'pointer', display: 'block', marginTop: 3 }}
            >
              Expand ↓
            </span>
          )}
        </div>
      )}

      {block.verdict && (
        <div style={{
          padding: collapsed ? '6px 14px 8px' : '8px 14px 2px',
          fontSize: 13, fontWeight: 500, color: INDIGO,
        }}>
          → {block.verdict}
        </div>
      )}

      {!collapsed && (
        <>
          <div className="delib-panels" style={{ paddingTop: 12 }}>
            {block.panels.map((panel, i) => (
              <PanelCard key={i} panel={panel} color={getPanelColor(panel)} />
            ))}
          </div>

          <div style={{
            margin: '2px 14px 14px',
            borderLeft: `4px solid ${TEAL}`,
            paddingLeft: 12,
            paddingTop: 8,
            paddingBottom: 8,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: INDIGO, marginBottom: 6,
            }}>
              Synthesis
            </div>
            <div style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.6 }}>
              {block.synthesis}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PanelCard({ panel, color }: { panel: DeliberationPanel; color: string }) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const pct = Math.min(100, Math.max(0, Math.round(panel.confidence * 100)));

  return (
    <div style={{
      border: '1px solid #1e293b',
      borderLeft: `3px solid ${color}`,
      borderRadius: 6,
      padding: '10px 10px 10px 12px',
      background: '#131f35',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>
          {panel.role}
        </span>
        <span style={{ fontSize: 11, color, fontVariantNumeric: 'tabular-nums' }}>
          {pct}%
        </span>
      </div>

      <div style={{ height: 3, background: '#1e293b', borderRadius: 2, marginBottom: 8, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2 }} />
      </div>

      <div
        style={{
          fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, marginBottom: 4,
          ...(summaryExpanded ? {} : {
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          } as React.CSSProperties),
        }}
      >
        {panel.summary}
      </div>
      {!summaryExpanded && panel.summary.length > 120 && (
        <button
          onClick={() => setSummaryExpanded(true)}
          style={{
            fontSize: 11, color: '#475569', background: 'none', border: 'none',
            padding: 0, cursor: 'pointer', marginBottom: 4,
          }}
        >
          Read more →
        </button>
      )}

      {panel.key_points.slice(0, 3).map((pt, i) => (
        <div
          key={i}
          style={{
            fontSize: 12, color: '#64748b', lineHeight: 1.45,
            paddingLeft: 10, position: 'relative', marginTop: 3,
          }}
        >
          <span style={{ position: 'absolute', left: 0, color }}>•</span>
          {pt}
        </div>
      ))}
    </div>
  );
}
