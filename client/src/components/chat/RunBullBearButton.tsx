import { useState } from 'react';
import { getAvatarById } from '../avatars/avatar-data';

interface RunBullBearButtonProps {
  entityName: string;
  onRun: () => void;
}

const BULL_SRC = getAvatarById('char-21')?.src ?? '';
const BEAR_SRC = getAvatarById('char-22')?.src ?? '';

export default function RunBullBearButton({ entityName, onRun }: RunBullBearButtonProps) {
  const [clicked, setClicked] = useState(false);
  const [bullFailed, setBullFailed] = useState(false);
  const [bearFailed, setBearFailed] = useState(false);

  function handleClick() {
    setClicked(true);
    onRun();
  }

  if (clicked) return null;

  return (
    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          background: 'transparent',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 12,
          color: 'rgba(245, 158, 11, 0.7)',
          transition: 'all 150ms ease',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget;
          el.style.borderColor = 'rgba(245, 158, 11, 0.8)';
          el.style.color = '#F59E0B';
          el.style.background = 'rgba(245, 158, 11, 0.08)';
        }}
        onMouseLeave={e => {
          const el = e.currentTarget;
          el.style.borderColor = 'rgba(245, 158, 11, 0.3)';
          el.style.color = 'rgba(245, 158, 11, 0.7)';
          el.style.background = 'transparent';
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {bullFailed ? (
            <span style={{ fontSize: 14, lineHeight: 1 }}>🐂</span>
          ) : (
            <img
              src={BULL_SRC}
              alt="Bull"
              style={{ width: 16, height: 16, borderRadius: 3, objectFit: 'cover' }}
              onError={() => setBullFailed(true)}
            />
          )}
          {bearFailed ? (
            <span style={{ fontSize: 14, lineHeight: 1, marginLeft: -2 }}>🐻</span>
          ) : (
            <img
              src={BEAR_SRC}
              alt="Bear"
              style={{ width: 16, height: 16, borderRadius: 3, objectFit: 'cover', marginLeft: -2 }}
              onError={() => setBearFailed(true)}
            />
          )}
        </div>
        <span>Run Bull/Bear on {entityName}</span>
      </button>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
        Argue both sides of this deal
      </span>
    </div>
  );
}
