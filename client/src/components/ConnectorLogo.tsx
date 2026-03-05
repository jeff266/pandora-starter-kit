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
      <svg viewBox="0 0 48 48" width="70%" height="70%" fill="white">
        <path d="M20 9a8 8 0 0 1 6 2.7A9.5 9.5 0 0 1 32.5 10c4 0 7.4 2.5 8.7 6.1.5-.1 1-.2 1.6-.2C46 15.9 48 18 48 20.5c0 2.6-2 4.6-4.5 4.6H7.2C4.3 25.1 2 22.8 2 19.9c0-2.5 1.8-4.6 4.2-5 .4-3.3 3.2-5.9 6.6-5.9 1.2 0 2.3.3 3.2.9A8 8 0 0 1 20 9z" />
      </svg>
    ),
  },
  gong: {
    bg: '#EE5F3D',
    content: (
      <svg viewBox="0 0 24 24" width="65%" height="65%" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="8" width="3.5" height="10" rx="1.75" fill="white"/>
        <rect x="10.25" y="5" width="3.5" height="13" rx="1.75" fill="white"/>
        <rect x="17.5" y="3" width="3.5" height="15" rx="1.75" fill="white"/>
      </svg>
    ),
  },
  fireflies: {
    bg: '#7C3AED',
    content: (
      <svg viewBox="0 0 24 24" width="62%" height="62%" fill="white" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2.5c0 0-1.5 3-1.5 5.5 0 1.5.5 2.5 1.5 3-1-.5-3.5-.5-4.5 2 1-1 2.5-.5 3.5.5-1.5 0-3 1.5-2.5 4 .5-1.5 2-2 3-1.5-1 1-1.5 3-.5 4.5.5-1.5 1.5-2 2.5-1.5-.5 1 0 3 1.5 3.5-.5-1.5 0-2.5 1-3 1 .5 1.5 1.5 1 3 1.5-.5 2-2 1.5-3.5 1 .5 2 1 2.5 2.5.5-2 0-3.5-1-4.5 1 .5 2.5-.5 3-2-1.5.5-2.5 0-3.5-1 1.5-.5 3-2 2.5-4.5-.5 1.5-2 2.5-3.5 2.5 1-1 1.5-3 .5-5-1.5 2-3.5 2-3.5 2s1.5-2.5 0-6z"/>
      </svg>
    ),
  },
  fathom: {
    bg: '#1a1a2e',
    content: (
      <svg viewBox="0 0 24 24" width="60%" height="60%" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" stroke="white" strokeWidth="1.8" fill="none"/>
        <path d="M8 9h8M8 12h5M8 15h6" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    ),
  },
  notion: {
    bg: '#2f2f2f',
    content: (
      <svg viewBox="0 0 24 24" width="62%" height="62%" fill="white" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 4.5C4 3.1 5.1 2 6.5 2h7.3c.7 0 1.3.3 1.8.7l3.7 3.7c.5.5.7 1.1.7 1.8v11.3c0 1.4-1.1 2.5-2.5 2.5H6.5C5.1 22 4 20.9 4 19.5V4.5zM8 8v2h8V8H8zm0 4v2h6v-2H8zm0 4v2h5v-2H8z"/>
      </svg>
    ),
  },
  asana: {
    bg: '#F06A6A',
    content: (
      <svg viewBox="0 0 24 24" width="65%" height="65%" fill="white" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="6.5" r="3.5"/>
        <circle cx="5.5" cy="16" r="3.5"/>
        <circle cx="18.5" cy="16" r="3.5"/>
      </svg>
    ),
  },
  monday: {
    bg: '#6161ff',
    content: (
      <svg viewBox="0 0 24 24" width="65%" height="65%" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="5" cy="15" r="3.5" fill="#ff7575"/>
        <circle cx="12" cy="11.5" r="3.5" fill="#ffcb00"/>
        <circle cx="19" cy="8" r="3.5" fill="#00d26a"/>
      </svg>
    ),
  },
  google_drive: {
    bg: '#4285f4',
    content: (
      <svg viewBox="0 0 24 24" width="60%" height="60%" fill="white">
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
