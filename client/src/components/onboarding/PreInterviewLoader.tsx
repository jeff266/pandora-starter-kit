import { useState, useEffect } from 'react';

interface Step {
  label: string;
  duration: number;
}

const STEPS: Step[] = [
  { label: 'Scanning your CRM data', duration: 1800 },
  { label: 'Researching your company', duration: 4000 },
  { label: 'Generating smart hypotheses', duration: 2500 },
  { label: 'Preparing your first question', duration: 800 },
];

interface PreInterviewLoaderProps {
  companyName?: string;
}

export function PreInterviewLoader({ companyName }: PreInterviewLoaderProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [dots, setDots] = useState('');

  useEffect(() => {
    let total = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < STEPS.length; i++) {
      total += STEPS[i].duration;
      const idx = i;
      timers.push(setTimeout(() => setStepIndex(idx + 1), total));
    }
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '60px 32px',
      gap: 24,
    }}>
      <div style={{ fontSize: 32, lineHeight: 1 }}>🔍</div>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ margin: '0 0 6px 0', color: 'var(--color-text)', fontSize: 20, fontWeight: 700 }}>
          Preparing your interview
        </h2>
        {companyName && (
          <p style={{ margin: 0, color: 'var(--color-textMuted)', fontSize: 14 }}>
            Analyzing {companyName}'s CRM data
          </p>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 340 }}>
        {STEPS.map((step, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: done ? 'var(--color-green)' : active ? 'var(--color-accent)' : 'var(--color-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                flexShrink: 0,
                transition: 'background 0.3s',
              }}>
                {done ? '✓' : active ? '…' : ''}
              </div>
              <span style={{
                fontSize: 13,
                color: done ? 'var(--color-green)' : active ? 'var(--color-text)' : 'var(--color-textMuted)',
                fontWeight: active ? 600 : 400,
              }}>
                {step.label}{active ? dots : ''}
              </span>
            </div>
          );
        })}
      </div>

      <p style={{ margin: 0, fontSize: 11, color: 'var(--color-textMuted)', textAlign: 'center' }}>
        Usually takes 5–10 seconds
      </p>
    </div>
  );
}
