import React, { useState } from 'react';
import { colors } from '../../styles/theme';
import { api } from '../../lib/api';

export interface DeliverableOption {
  id: string;
  label: string;
  icon: string;
  sub: string;
}

interface DeliverablePickerProps {
  options: DeliverableOption[];
}

export default function DeliverablePicker({ options }: DeliverablePickerProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [ready, setReady] = useState(false);

  const handleSelect = async (id: string) => {
    setSelected(id);
    setGenerating(true);
    setReady(false);
    try {
      await api.post('/deliverables/generate', { format: id });
      setReady(true);
    } catch {
      setReady(true);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        Export As
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {options.map(opt => {
          const isSelected = selected === opt.id;
          return (
            <div
              key={opt.id}
              onClick={() => !generating && handleSelect(opt.id)}
              style={{
                background: isSelected ? colors.accentSoft : colors.surface,
                border: `1px solid ${isSelected ? colors.accent : colors.border}`,
                borderRadius: 8, padding: '10px 12px', cursor: generating ? 'default' : 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!isSelected && !generating) { (e.currentTarget as HTMLDivElement).style.borderColor = colors.accent; } }}
              onMouseLeave={e => { if (!isSelected) { (e.currentTarget as HTMLDivElement).style.borderColor = colors.border; } }}
            >
              <div style={{ fontSize: 20, marginBottom: 4 }}>{opt.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>{opt.label}</div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>{opt.sub}</div>
            </div>
          );
        })}
      </div>
      {selected && (
        <div style={{ marginTop: 10, fontSize: 12, color: generating ? colors.textMuted : colors.accent }}>
          {generating ? 'Generating...' : ready ? 'Ready — Download / Preview' : ''}
        </div>
      )}
    </div>
  );
}
