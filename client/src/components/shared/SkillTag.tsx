import React from 'react';
import { colors, fonts } from '../../styles/theme';

interface SkillTagProps {
  skillName: string;
  variant?: "default" | "secondary" | "outline";
  className?: string;
}

export function SkillTag({ skillName, variant = "secondary", className }: SkillTagProps) {
  const getVariantStyles = () => {
    switch (variant) {
      case 'default':
        return {
          background: colors.accent,
          color: '#fff',
          border: 'none',
        };
      case 'outline':
        return {
          background: 'transparent',
          color: colors.text,
          border: `1px solid ${colors.border}`,
        };
      case 'secondary':
      default:
        return {
          background: colors.surfaceHover,
          color: colors.textSecondary,
          border: 'none',
        };
    }
  };

  const variantStyles = getVariantStyles();

  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: fonts.mono,
        fontSize: 11,
        fontWeight: 500,
        padding: '2px 8px',
        borderRadius: 4,
        ...variantStyles,
      }}
      className={className}
    >
      {skillName}
    </span>
  );
}
