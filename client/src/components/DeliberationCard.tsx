import { useState } from 'react';

interface DeliberationPerspective {
  role: 'prosecutor' | 'defense';
  output: string;
  closeProbability: number;
}

interface DeliberationVerdict {
  expectedValue: number;
  keyVariable: string;
  reevaluateBy: string;
  recommendedAction: string;
  rawOutput: string;
}

interface DeliberationData {
  dealId: string;
  dealName: string;
  dealAmount: number;
  dealStage: string;
  ownerName: string;
  perspectives: {
    prosecutor: DeliberationPerspective;
    defense: DeliberationPerspective;
  };
  verdict: DeliberationVerdict;
  tokenCost: number;
}

interface DeliberationCardProps {
  deliberation: DeliberationData;
}

const CORAL = '#f97068';
const TEAL = '#14b8a6';
const DARK_BG = '#0f172a';
const CARD_BG = '#111827';
const BORDER = '#1e293b';

function formatOutput(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return <div key={i} style={{ height: 6 }} />;
    const isNumbered = /^\d+\./.test(trimmed);
    const isProbability = /close probability/i.test(trimmed);
    return (
      <div
        key={i}
        style={{
          fontSize: 13,
          lineHeight: 1.6,
          color: isProbability ? '#94a3b8' : '#cbd5e1',
          fontWeight: isNumbered ? 500 : 400,
          marginBottom: isNumbered ? 4 : 0,
          paddingLeft: isNumbered ? 0 : 0,
        }}
      >
        {trimmed}
      </div>
    );
  });
}

function Avatar({ letter, color }: { letter: string; color: string }) {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        backgroundColor: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: 13,
        fontWeight: 700,
        color: '#fff',
        fontFamily: 'JetBrains Mono, monospace',
      }}
    >
      {letter}
    </div>
  );
}

function ProbabilityBadge({ value, color }: { value: number; color: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color,
        backgroundColor: `${color}18`,
        border: `1px solid ${color}40`,
        borderRadius: 4,
        padding: '2px 8px',
        letterSpacing: '0.05em',
        fontFamily: 'JetBrains Mono, monospace',
      }}
    >
      {value}% close
    </div>
  );
}

export default function DeliberationCard({ deliberation }: DeliberationCardProps) {
  const [expanded, setExpanded] = useState(true);

  const { perspectives, verdict } = deliberation;
  const midProb = Math.round((perspectives.prosecutor.closeProbability + perspectives.defense.closeProbability) / 2);

  return (
    <div
      style={{
        marginTop: 16,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: CARD_BG,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: `1px solid ${BORDER}`,
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Prosecutor / Defense
          </span>
          <span style={{ fontSize: 11, color: '#475569' }}>
            {deliberation.dealName}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'JetBrains Mono, monospace' }}>
            midpoint {midProb}%
          </span>
          <span style={{ fontSize: 12, color: '#475569' }}>{expanded ? '↑' : '↓'}</span>
        </div>
      </div>

      {expanded && (
        <div>
          <div
            style={{
              borderLeft: `3px solid ${CORAL}`,
              margin: '12px 14px 0',
              padding: '10px 12px',
              borderRadius: '0 6px 6px 0',
              backgroundColor: `${CORAL}08`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <Avatar letter="P" color={CORAL} />
              <span style={{ fontSize: 12, fontWeight: 600, color: CORAL, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Prosecutor</span>
              <ProbabilityBadge value={perspectives.prosecutor.closeProbability} color={CORAL} />
            </div>
            <div>{formatOutput(perspectives.prosecutor.output)}</div>
          </div>

          <div
            style={{
              borderLeft: `3px solid ${TEAL}`,
              margin: '12px 14px 0',
              padding: '10px 12px',
              borderRadius: '0 6px 6px 0',
              backgroundColor: `${TEAL}08`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <Avatar letter="D" color={TEAL} />
              <span style={{ fontSize: 12, fontWeight: 600, color: TEAL, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Defense</span>
              <ProbabilityBadge value={perspectives.defense.closeProbability} color={TEAL} />
            </div>
            <div>{formatOutput(perspectives.defense.output)}</div>
          </div>

          <div
            style={{
              margin: '12px 14px 14px',
              padding: '12px',
              borderRadius: 6,
              backgroundColor: DARK_BG,
              border: `1px solid ${BORDER}`,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#475569',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                marginBottom: 10,
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              VERDICT
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <VerdictRow label="Expected value" value={`$${Math.round(verdict.expectedValue).toLocaleString()}`} />
              <VerdictRow label="Key variable" value={verdict.keyVariable} />
              <VerdictRow label="Re-evaluate by" value={verdict.reevaluateBy} />
              <div style={{ marginTop: 4, paddingTop: 8, borderTop: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>Recommended action</div>
                <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.5 }}>{verdict.recommendedAction}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VerdictRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <span style={{ fontSize: 11, color: '#64748b', minWidth: 110, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.4 }}>{value}</span>
    </div>
  );
}
