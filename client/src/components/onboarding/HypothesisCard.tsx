import { useState } from 'react';

interface HypothesisRow {
  [key: string]: string | number | null;
}

interface Hypothesis {
  summary: string;
  table?: HypothesisRow[];
  columns?: string[];
  confidence: number;
  evidence: string;
  suggested_value?: unknown;
  options?: Array<{ id: string; label: string; description: string }>;
}

interface HypothesisCardProps {
  hypothesis: Hypothesis;
  onOptionSelect?: (optionId: string) => void;
}

function ConfidenceDot({ confidence }: { confidence: number }) {
  const color = confidence >= 0.8 ? 'var(--color-green)' : confidence >= 0.5 ? 'var(--color-yellow)' : 'var(--color-red)';
  const label = confidence >= 0.8 ? 'High confidence' : confidence >= 0.5 ? 'Medium confidence' : 'Low confidence';
  return (
    <span
      title={`${label} (${Math.round(confidence * 100)}%)`}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        marginLeft: 6,
        verticalAlign: 'middle',
        flexShrink: 0,
      }}
    />
  );
}

export function HypothesisCard({ hypothesis, onOptionSelect }: HypothesisCardProps) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  function handleOptionClick(id: string) {
    setSelectedOption(id);
    onOptionSelect?.(id);
  }

  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 10,
      padding: '14px 16px',
      marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--color-textMuted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
          Based on your CRM data
        </span>
        <ConfidenceDot confidence={hypothesis.confidence} />
      </div>

      <p style={{ margin: '0 0 12px 0', color: 'var(--color-text)', fontSize: 14, lineHeight: 1.55 }}>
        {hypothesis.summary}
      </p>

      {hypothesis.table && hypothesis.table.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {(hypothesis.columns ?? Object.keys(hypothesis.table[0])).map(col => (
                  <th key={col} style={{
                    textAlign: 'left', padding: '5px 8px', borderBottom: '1px solid var(--color-border)',
                    color: 'var(--color-textMuted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase',
                    letterSpacing: '0.04em', whiteSpace: 'nowrap',
                  }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hypothesis.table.map((row, i) => (
                <tr key={i} style={{ background: i % 2 === 1 ? 'var(--color-bg)' : 'transparent' }}>
                  {(hypothesis.columns ?? Object.keys(row)).map(col => (
                    <td key={col} style={{ padding: '5px 8px', color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)', fontSize: 13 }}>
                      {row[col] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hypothesis.options && hypothesis.options.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {hypothesis.options.map(opt => (
            <button
              key={opt.id}
              onClick={() => handleOptionClick(opt.id)}
              title={opt.description}
              style={{
                padding: '5px 12px',
                borderRadius: 6,
                border: selectedOption === opt.id
                  ? '1.5px solid var(--color-accent)'
                  : '1px solid var(--color-border)',
                background: selectedOption === opt.id ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'var(--color-bg)',
                color: selectedOption === opt.id ? 'var(--color-accent)' : 'var(--color-text)',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: selectedOption === opt.id ? 600 : 400,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {hypothesis.evidence && (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--color-textMuted)', fontStyle: 'italic', lineHeight: 1.4 }}>
          {hypothesis.evidence}
        </p>
      )}
    </div>
  );
}
