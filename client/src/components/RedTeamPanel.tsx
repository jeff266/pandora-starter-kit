import { useState, useEffect, useRef } from 'react';
import { colors } from '../styles/theme';

interface RedTeamResult {
  pattern: 'red_team';
  hypothesisId: string;
  perspectives: {
    agent: 'plan' | 'red_team';
    label: string;
    output: string;
  }[];
  verdict: {
    planSufficiency: string;
    missingAction: string | null;
    watchMetric: string;
    raw: string;
  };
  tokenCost: number;
}

const AGENT_CONFIG = {
  plan:     { label: 'Current Plan', monogram: 'P', bgColor: '#185FA5', textColor: '#fff' },
  red_team: { label: 'Red Team',     monogram: 'R', bgColor: '#993C1D', textColor: '#fff' },
};

const SUFFICIENCY_COLORS: Record<string, { bg: string; text: string }> = {
  sufficient:   { bg: 'rgba(34,197,94,0.12)',  text: '#22c55e' },
  borderline:   { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b' },
  insufficient: { bg: 'rgba(239,68,68,0.12)',  text: '#ef4444' },
};

function useTypewriter(text: string, active: boolean, speed = 18) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active || !text) return;
    indexRef.current = 0;
    setDisplayed('');
    setDone(false);

    function type() {
      if (indexRef.current >= text.length) {
        setDone(true);
        return;
      }
      const char = text[indexRef.current];
      setDisplayed(prev => prev + char);
      indexRef.current++;
      const delay = char === '.' ? 260 : char === ',' ? 100 : char === ' ' ? 22 : speed + Math.random() * 12;
      timerRef.current = setTimeout(type, delay);
    }

    timerRef.current = setTimeout(type, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, active, speed]);

  return { displayed, done };
}

export default function RedTeamPanel({ result }: { result: RedTeamResult }) {
  const plan = result.perspectives.find(p => p.agent === 'plan')!;
  const redTeam = result.perspectives.find(p => p.agent === 'red_team')!;

  const planTyper = useTypewriter(plan.output, true);
  const redTeamTyper = useTypewriter(redTeam.output, planTyper.done);
  const [verdictVisible, setVerdictVisible] = useState(false);

  useEffect(() => {
    if (redTeamTyper.done) {
      const t = setTimeout(() => setVerdictVisible(true), 400);
      return () => clearTimeout(t);
    }
  }, [redTeamTyper.done]);

  const sufficiencyColors = SUFFICIENCY_COLORS[result.verdict.planSufficiency] ?? SUFFICIENCY_COLORS.borderline;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <AgentTurn
        config={AGENT_CONFIG.plan}
        text={planTyper.displayed}
        isTyping={!planTyper.done}
      />

      {planTyper.done && (
        <AgentTurn
          config={AGENT_CONFIG.red_team}
          text={redTeamTyper.displayed}
          isTyping={!redTeamTyper.done}
        />
      )}

      {verdictVisible && (
        <div style={{
          padding: '12px',
          background: colors.surfaceRaised,
          borderRadius: 8,
          border: `1px solid ${colors.border}`,
          opacity: verdictVisible ? 1 : 0,
          transition: 'opacity 0.4s ease',
        }}>
          <div style={{
            fontSize: '10px',
            fontWeight: 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
            color: colors.textMuted,
            marginBottom: '8px',
          }}>
            Verdict
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{
              padding: '2px 8px',
              borderRadius: 6,
              fontSize: '11px',
              fontWeight: 500,
              background: sufficiencyColors.bg,
              color: sufficiencyColors.text,
              textTransform: 'capitalize' as const,
            }}>
              {result.verdict.planSufficiency}
            </span>
          </div>

          {result.verdict.missingAction && (
            <p style={{
              fontSize: '13px',
              color: colors.text,
              marginBottom: '6px',
              lineHeight: 1.5,
            }}>
              <strong>Missing:</strong> {result.verdict.missingAction}
            </p>
          )}

          <p style={{
            fontSize: '13px',
            color: colors.textMuted,
            lineHeight: 1.5,
            margin: 0,
          }}>
            <strong>Watch:</strong> {result.verdict.watchMetric}
          </p>
        </div>
      )}

      <style>{`@keyframes rt-blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </div>
  );
}

function AgentTurn({
  config,
  text,
  isTyping,
}: {
  config: typeof AGENT_CONFIG.plan;
  text: string;
  isTyping: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
      <div style={{
        width: '28px',
        height: '28px',
        borderRadius: '50%',
        background: config.bgColor,
        color: config.textColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '11px',
        fontWeight: 500,
        flexShrink: 0,
        marginTop: '2px',
      }}>
        {config.monogram}
      </div>

      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: '10px',
          fontWeight: 500,
          letterSpacing: '0.06em',
          textTransform: 'uppercase' as const,
          color: colors.textMuted,
          marginBottom: '4px',
        }}>
          {config.label}
        </div>

        <p style={{
          fontSize: '13px',
          lineHeight: 1.6,
          color: colors.text,
          margin: 0,
        }}>
          {text}
          {isTyping && (
            <span style={{
              display: 'inline-block',
              width: '2px',
              height: '13px',
              background: colors.textMuted,
              marginLeft: '2px',
              verticalAlign: 'text-bottom',
              animation: 'rt-blink 0.8s step-end infinite',
            }} />
          )}
        </p>
      </div>
    </div>
  );
}
