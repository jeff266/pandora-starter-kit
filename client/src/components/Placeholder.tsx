import React from 'react';
import { colors } from '../styles/theme';

export default function Placeholder({ title }: { title: string }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '60vh',
      color: colors.textMuted,
    }}>
      <h2 style={{ fontSize: 17, fontWeight: 600, color: colors.textSecondary }}>
        {title}
      </h2>
      <p style={{ fontSize: 13, marginTop: 8 }}>
        Coming soon
      </p>
    </div>
  );
}
