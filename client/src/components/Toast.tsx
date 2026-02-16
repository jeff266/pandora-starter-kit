import React, { useEffect } from 'react';
import { colors } from '../styles/theme';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  duration?: number;
  onClose: () => void;
}

export default function Toast({ message, type, duration = 3000, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const bgColor = {
    success: colors.greenSoft,
    error: colors.redSoft,
    info: colors.accentSoft,
  }[type];

  const textColor = {
    success: colors.green,
    error: colors.red,
    info: colors.accent,
  }[type];

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      background: bgColor,
      border: `1px solid ${textColor}`,
      borderRadius: 8,
      padding: '12px 16px',
      color: textColor,
      fontSize: 14,
      zIndex: 9999,
      maxWidth: 300,
      animation: 'slideUp 0.3s ease-out',
    }}>
      {message}
    </div>
  );
}
