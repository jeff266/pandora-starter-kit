import React, { useState } from 'react';
import { colors, fonts } from '../../styles/theme';
import { AVATAR_GALLERY, type AvatarOption } from './avatar-data';
import { X } from 'lucide-react';

interface Props {
  currentValue?: string | null;
  onSelect: (avatarSrc: string) => void;
  onClose: () => void;
}

export default function AvatarPicker({ currentValue, onSelect, onClose }: Props) {
  const [selected, setSelected] = useState<string | null>(currentValue || null);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 16,
          width: 520,
          maxWidth: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: `1px solid ${colors.border}`,
        }}>
          <div>
            <h3 style={{ font: `600 16px ${fonts.sans}`, color: colors.text, margin: 0 }}>
              Choose an Avatar
            </h3>
            <p style={{ font: `400 13px ${fonts.sans}`, color: colors.textMuted, margin: '4px 0 0' }}>
              Pick a character to represent you
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: colors.textMuted,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: 20,
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 12,
          }}>
            {AVATAR_GALLERY.map(avatar => {
              const isSelected = selected === avatar.src;
              return (
                <button
                  key={avatar.id}
                  onClick={() => setSelected(avatar.src)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    padding: 10,
                    borderRadius: 12,
                    border: `2px solid ${isSelected ? colors.accent : 'transparent'}`,
                    background: isSelected ? colors.accentSoft : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    if (!isSelected) e.currentTarget.style.background = colors.surfaceHover;
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <img
                    src={avatar.src}
                    alt={avatar.label}
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 8,
                      imageRendering: 'pixelated',
                    }}
                  />
                  <span style={{
                    font: `400 11px ${fonts.sans}`,
                    color: isSelected ? colors.accent : colors.textMuted,
                    textAlign: 'center',
                    lineHeight: '1.2',
                  }}>
                    {avatar.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          padding: '14px 20px',
          borderTop: `1px solid ${colors.border}`,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: 'transparent',
              color: colors.text,
              font: `400 13px ${fonts.sans}`,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (selected) {
                onSelect(selected);
                onClose();
              }
            }}
            disabled={!selected}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              border: 'none',
              background: selected ? colors.accent : colors.surfaceHover,
              color: selected ? '#fff' : colors.textMuted,
              font: `500 13px ${fonts.sans}`,
              cursor: selected ? 'pointer' : 'not-allowed',
            }}
          >
            Select
          </button>
        </div>
      </div>
    </div>
  );
}
