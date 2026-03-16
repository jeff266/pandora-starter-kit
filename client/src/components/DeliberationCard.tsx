import React, { useState, useEffect, useRef } from 'react';
import { PixelAvatarBull, PixelAvatarBear } from './PixelAvatar';

interface DeliberationPerspective {
  role: 'bull' | 'bear';
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
    bull: DeliberationPerspective;
    bear: DeliberationPerspective;
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

function stripMarkdown(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
}

function useTypewriter(text: string, active: boolean, speed = 18): { displayed: string; done: boolean } {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active || !text) return;
    indexRef.current = 0;
    setDisplayed('');
    setDone(false);

    function getDelay(char: string): number {
      if (char === '.') return 180;
      if (char === ',') return 80;
      if (char === '\n') return 60;
      if (char === ' ') return 16;
      return speed + Math.random() * 10;
    }

    function typeNext() {
      if (indexRef.current >= text.length) {
        setDone(true);
        return;
      }
      const char = text[indexRef.current];
      setDisplayed(prev => prev + char);
      indexRef.current++;
      timerRef.current = setTimeout(typeNext, getDelay(char));
    }

    timerRef.current = setTimeout(typeNext, 120);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, text, speed]);

  return { displayed, done };
}

function TypewriterText({ text, active }: { text: string; active: boolean }) {
  const { displayed, done } = useTypewriter(text, active);
  const lines = displayed.split('\n');

  return (
    <div>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} style={{ height: 5 }} />;
        const isNumbered = /^\d+\./.test(trimmed);
        const isProb = /close probability/i.test(trimmed);
        return (
          <div
            key={i}
            style={{
              fontSize: 13,
              lineHeight: 1.65,
              color: isProb ? '#94a3b8' : '#cbd5e1',
              fontWeight: isNumbered ? 500 : 400,
              marginBottom: isNumbered ? 3 : 0,
            }}
          >
            {trimmed}
          </div>
        );
      })}
      {!done && active && (
        <span
          style={{
            display: 'inline-block',
            width: '1.5px',
            height: '0.9em',
            background: '#5a6578',
            marginLeft: '2px',
            verticalAlign: 'text-bottom',
            animation: 'tw-blink 0.85s step-end infinite',
          }}
        />
      )}
      <style>{`@keyframes tw-blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
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

function AgentSection({
  label,
  color,
  avatar,
  probability,
  text,
  active,
}: {
  label: string;
  color: string;
  avatar: React.ReactNode;
  probability: number;
  text: string;
  active: boolean;
}) {
  const scaleStyle: React.CSSProperties = {
    transform: active ? 'scale(1)' : 'scale(0.92)',
    opacity: active ? 1 : 0,
    transition: 'transform 200ms ease, opacity 200ms ease',
  };

  return (
    <div
      style={{
        borderLeft: `3px solid ${color}`,
        margin: '12px 14px 0',
        padding: '10px 12px',
        borderRadius: '0 6px 6px 0',
        backgroundColor: `${color}08`,
        ...scaleStyle,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>{avatar}</div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </span>
        <ProbabilityBadge value={probability} color={color} />
      </div>
      {active && <TypewriterText text={stripMarkdown(text)} active={active} />}
    </div>
  );
}

export default function DeliberationCard({ deliberation }: DeliberationCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [bearActive, setBearActive] = useState(false);
  const [verdictVisible, setVerdictVisible] = useState(false);

  const bullText = stripMarkdown(deliberation.perspectives.bull.output);
  const { done: bullDone } = useTypewriter(bullText, expanded);

  useEffect(() => {
    if (!bullDone || !expanded) return;
    const t = setTimeout(() => setBearActive(true), 600);
    return () => clearTimeout(t);
  }, [bullDone, expanded]);

  const bearText = stripMarkdown(deliberation.perspectives.bear.output);
  const { done: bearDone } = useTypewriter(bearText, bearActive);

  useEffect(() => {
    if (!bearDone || !bearActive) return;
    const t = setTimeout(() => setVerdictVisible(true), 400);
    return () => clearTimeout(t);
  }, [bearDone, bearActive]);

  const { perspectives, verdict } = deliberation;
  const midProb = Math.round(
    (perspectives.bull.closeProbability + perspectives.bear.closeProbability) / 2
  );

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
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#94a3b8',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Bull / Bear Analysis
          </span>
          <span style={{ fontSize: 11, color: '#475569' }}>{deliberation.dealName}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontSize: 12,
              color: '#64748b',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            midpoint {midProb}%
          </span>
          <span style={{ fontSize: 12, color: '#475569' }}>{expanded ? '↑' : '↓'}</span>
        </div>
      </div>

      {expanded && (
        <div>
          <AgentSection
            label="Bull Case"
            color={TEAL}
            avatar={<PixelAvatarBull size={32} />}
            probability={perspectives.bull.closeProbability}
            text={bullText}
            active={true}
          />

          <AgentSection
            label="Bear Case"
            color={CORAL}
            avatar={<PixelAvatarBear size={32} />}
            probability={perspectives.bear.closeProbability}
            text={bearText}
            active={bearActive}
          />

          <div
            style={{
              margin: '12px 14px 14px',
              padding: '12px',
              borderRadius: 6,
              backgroundColor: DARK_BG,
              border: `1px solid ${BORDER}`,
              opacity: verdictVisible ? 1 : 0,
              transform: verdictVisible ? 'translateY(0)' : 'translateY(6px)',
              transition: 'opacity 0.4s ease, transform 0.4s ease',
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
              <VerdictRow
                label="Expected value"
                value={`$${Math.round(verdict.expectedValue).toLocaleString()}`}
              />
              <VerdictRow label="Key variable" value={verdict.keyVariable} />
              <VerdictRow label="Re-evaluate by" value={verdict.reevaluateBy} />
              <div style={{ marginTop: 4, paddingTop: 8, borderTop: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>
                  Recommended action
                </div>
                <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.5 }}>
                  {verdict.recommendedAction}
                </div>
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
      <span style={{ fontSize: 11, color: '#64748b', minWidth: 110, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.4 }}>{value}</span>
    </div>
  );
}
