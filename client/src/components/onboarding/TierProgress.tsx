interface QuestionStatus {
  id: string;
  title: string;
  status: 'pending' | 'answered' | 'skipped' | 'active';
}

interface TierProgressProps {
  questions: QuestionStatus[];
  tier?: number;
}

export function TierProgress({ questions, tier = 0 }: TierProgressProps) {
  const answered = questions.filter(q => q.status === 'answered').length;
  const skipped = questions.filter(q => q.status === 'skipped').length;
  const total = questions.length;
  const done = answered + skipped;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-textMuted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Tier {tier} Setup
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-textMuted)' }}>{done}/{total}</span>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {questions.map(q => {
          let bg = 'var(--color-border)';
          let title = q.title;
          if (q.status === 'answered') { bg = 'var(--color-green)'; title += ' ✓'; }
          else if (q.status === 'skipped') { bg = 'var(--color-textMuted)'; title += ' (skipped)'; }
          else if (q.status === 'active') { bg = 'var(--color-accent)'; title += ' ← current'; }

          return (
            <div
              key={q.id}
              title={title}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                background: bg,
                transition: 'background 0.2s',
              }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {questions.map(q => (
          <span
            key={q.id}
            style={{
              fontSize: 10,
              color: q.status === 'active' ? 'var(--color-accent)' : q.status === 'answered' ? 'var(--color-green)' : 'var(--color-textMuted)',
              fontWeight: q.status === 'active' ? 700 : 400,
              whiteSpace: 'nowrap',
            }}
          >
            {q.status === 'answered' ? '✓' : q.status === 'skipped' ? '–' : q.status === 'active' ? '●' : '○'} {q.title}
          </span>
        ))}
      </div>
    </div>
  );
}
