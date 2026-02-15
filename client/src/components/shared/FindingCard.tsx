import React from 'react';
import { colors, fonts } from '../../styles/theme';
import SeverityDot from './SeverityDot';
import TimeAgo from './TimeAgo';

interface Finding {
  id: string;
  severity: string;
  message: string;
  skill_id: string;
  deal_id?: string;
  deal_name?: string;
  account_id?: string;
  account_name?: string;
  owner_email?: string;
  found_at: string;
}

interface FindingCardProps {
  finding: Finding;
  onClick?: (finding: Finding) => void;
}

export default function FindingCard({ finding, onClick }: FindingCardProps) {
  const [isHovered, setIsHovered] = React.useState(false);
  const isClickable = !!(finding.deal_id || finding.account_id || onClick);

  return (
    <div
      style={{
        padding: '10px 0',
        borderBottom: `1px solid ${colors.border}`,
        cursor: isClickable ? 'pointer' : 'default',
        background: isHovered && isClickable ? colors.surfaceHover : 'transparent',
        transition: 'background 0.15s',
      }}
      onClick={() => onClick?.(finding)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ marginTop: 5 }}>
          <SeverityDot severity={finding.severity} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, color: colors.text, lineHeight: 1.4, margin: 0 }}>
            {finding.message}
          </p>
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginTop: 4,
              fontSize: 11,
              color: colors.textMuted,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontFamily: fonts.mono }}>{finding.skill_id}</span>
            {finding.deal_name && (
              <span style={{ color: colors.accent }}>{finding.deal_name}</span>
            )}
            {finding.account_name && (
              <span style={{ color: colors.accent }}>{finding.account_name}</span>
            )}
            {finding.owner_email && <span>{finding.owner_email}</span>}
            <span>
              <TimeAgo date={finding.found_at} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
