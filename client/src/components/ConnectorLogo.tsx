import React from 'react';

interface Props {
  type: string;
  size?: number;
}

const logos: Record<string, { bg: string; content: React.ReactNode }> = {
  hubspot: {
    bg: '#ff7a59',
    content: (
      <svg viewBox="0 0 24 24" width="60%" height="60%" fill="white">
        <path d="M17.5 8.2V5.8c.6-.3 1-1 1-1.7C18.5 3 17.6 2 16.5 2S14.5 3 14.5 4.1c0 .7.4 1.4 1 1.7v2.4c-1.1.3-2.1.9-2.9 1.7l-7.3-5.7c.1-.2.1-.5.1-.7C5.4 2.2 4.3 1 2.9 1S.5 2.2.5 3.5 1.6 6 2.9 6c.5 0 1-.2 1.4-.4l7.2 5.6c-.7 1-1 2.2-1 3.3 0 1.5.5 2.8 1.5 3.9l-1.8 1.8c-.2-.1-.4-.1-.6-.1-.9 0-1.6.7-1.6 1.6s.7 1.6 1.6 1.6 1.6-.7 1.6-1.6c0-.2 0-.4-.1-.6l1.8-1.8c1 .8 2.3 1.3 3.6 1.3 3.3 0 6-2.7 6-6 0-2.8-2-5.2-4.9-5.8zM16.5 18c-2 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5S20 12.5 20 14.5 18.4 18 16.5 18z" />
      </svg>
    ),
  },
  salesforce: {
    bg: '#00a1e0',
    content: (
      <svg viewBox="0 0 24 24" width="70%" height="70%" fill="white">
        <path d="M10 4.5c1-.9 2.3-1.5 3.7-1.5 1.8 0 3.4.9 4.3 2.3.8-.4 1.6-.5 2.5-.5C23 4.8 25 7 25 9.5c0 .4 0 .7-.1 1 1.5.7 2.6 2.3 2.6 4.1 0 2.5-2 4.5-4.5 4.5h-.3c-.7 1.5-2.2 2.4-3.9 2.4-1 0-1.8-.3-2.6-.8-.7 1.2-2 2-3.5 2-1.3 0-2.4-.6-3.2-1.5-.5.2-1 .3-1.5.3-2.2 0-4-1.8-4-4 0-.7.2-1.3.4-1.9C2.6 14.6 1 12.8 1 10.5c0-2.5 2-4.5 4.5-4.5 1.7 0 3.2 1 3.9 2.3.2-.1.4-.1.6-.1v-3.7z" transform="scale(0.85) translate(1.5,2)" />
      </svg>
    ),
  },
  gong: {
    bg: '#7c3aed',
    content: (
      <svg viewBox="0 0 24 24" width="55%" height="55%" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="12" cy="12" r="6" />
        <line x1="12" y1="2" x2="12" y2="4" />
        <line x1="12" y1="20" x2="12" y2="22" />
        <line x1="4" y1="8" x2="2" y2="7" />
        <line x1="20" y1="8" x2="22" y2="7" />
      </svg>
    ),
  },
  fireflies: {
    bg: '#a855f7',
    content: (
      <svg viewBox="0 0 24 24" width="55%" height="55%" fill="white">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" opacity="0" />
        <path d="M12 3a1.5 1.5 0 010 3 1.5 1.5 0 010-3zM7 7a1 1 0 012 0 1 1 0 01-2 0zM15 7a1 1 0 012 0 1 1 0 01-2 0zM5 12a1.5 1.5 0 013 0 1.5 1.5 0 01-3 0zM16 12a1.5 1.5 0 013 0 1.5 1.5 0 01-3 0zM9 16a1 1 0 012 0 1 1 0 01-2 0zM13 16a1 1 0 012 0 1 1 0 01-2 0zM11 20a1.5 1.5 0 010 3 1.5 1.5 0 010-3z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  monday: {
    bg: '#6161ff',
    content: (
      <svg viewBox="0 0 24 24" width="55%" height="55%" fill="white">
        <ellipse cx="5" cy="16" rx="2.5" ry="2.5" />
        <ellipse cx="12" cy="12" rx="2.5" ry="2.5" />
        <ellipse cx="19" cy="8" rx="2.5" ry="2.5" />
      </svg>
    ),
  },
  'google-drive': {
    bg: '#4285f4',
    content: (
      <svg viewBox="0 0 24 24" width="55%" height="55%" fill="white">
        <path d="M8 2l8 0 4 7H12L8 2zM2 15l4-7h8l-4 7H2zM14 15l4-7 4 7H14zM6.5 16h11l-2.5 4h-11l2.5-4z" />
      </svg>
    ),
  },
};

export default function ConnectorLogo({ type, size = 36 }: Props) {
  const logo = logos[type];

  if (!logo) {
    return (
      <div style={{
        width: size, height: size, borderRadius: 8,
        background: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.44, fontWeight: 700, color: '#fff', flexShrink: 0,
      }}>
        {type.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: 8, background: logo.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      {logo.content}
    </div>
  );
}
