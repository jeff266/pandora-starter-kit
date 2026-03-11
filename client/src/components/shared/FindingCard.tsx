import React from 'react';
import { colors, fonts } from '../../styles/theme';
import SeverityDot from './SeverityDot';
import TimeAgo from './TimeAgo';

interface TriSignal {
  icp_grade: string | null;
  rfm_grade: string | null;
  rfm_label: string | null;
  tte_prob: number | null;
}

interface Finding {
  id: string;
  severity: string;
  message: string;
  skill_id: string;
  category?: string;
  metadata?: Record<string, any>;
  deal_id?: string;
  deal_name?: string;
  account_id?: string;
  account_name?: string;
  owner_email?: string;
  found_at: string;
  tri_signal?: TriSignal | null;
}

interface FindingCardProps {
  finding: Finding;
  onClick?: (finding: Finding) => void;
  onAskPandora?: (finding: Finding) => void;
  onCreateRule?: (finding: Finding) => void;
}

const GRADE_COLORS: Record<string, string> = {
  A: '#22c55e',
  B: '#86efac',
  C: '#f59e0b',
  D: '#f97316',
  F: '#ef4444',
};

function gradeColor(grade: string | null): string {
  return grade ? (GRADE_COLORS[grade] ?? colors.textMuted) : colors.textMuted;
}

function TriSignalBadges({ sig }: { sig: TriSignal }) {
  const hasSomething = sig.icp_grade || sig.rfm_grade || sig.tte_prob != null;
  if (!hasSomething) return null;

  const badge = (label: string, color: string, bg: string) => (
    <span
      key={label}
      style={{
        fontSize: 10,
        fontWeight: 600,
        fontFamily: fonts.mono,
        padding: '2px 6px',
        borderRadius: 4,
        border: `1px solid ${color}44`,
        color,
        background: bg,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );

  return (
    <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
      {sig.icp_grade && badge(
        `ICP: ${sig.icp_grade}`,
        gradeColor(sig.icp_grade),
        `${gradeColor(sig.icp_grade)}18`
      )}
      {sig.rfm_grade && badge(
        `Beh: ${sig.rfm_grade}${sig.rfm_label ? ` · ${sig.rfm_label}` : ''}`,
        gradeColor(sig.rfm_grade),
        `${gradeColor(sig.rfm_grade)}18`
      )}
      {sig.tte_prob != null && badge(
        `Prob: ${Math.round(sig.tte_prob * 100)}%`,
        sig.tte_prob >= 0.3 ? '#22c55e' : sig.tte_prob >= 0.1 ? '#f59e0b' : '#ef4444',
        sig.tte_prob >= 0.3 ? '#22c55e18' : sig.tte_prob >= 0.1 ? '#f59e0b18' : '#ef444418'
      )}
    </div>
  );
}

export default function FindingCard({ finding, onClick, onAskPandora, onCreateRule }: FindingCardProps) {
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
          {finding.tri_signal && <TriSignalBadges sig={finding.tri_signal} />}
          {(onAskPandora || onCreateRule) && (
            <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
              {onAskPandora && (
                <button
                  onClick={(e) => { e.stopPropagation(); onAskPandora(finding); }}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 10px',
                    borderRadius: 4,
                    border: `1px solid ${colors.accent}44`,
                    background: 'transparent',
                    color: colors.accent,
                    cursor: 'pointer',
                    fontFamily: fonts.mono,
                    transition: 'background 0.12s, border-color 0.12s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = `${colors.accent}18`;
                    e.currentTarget.style.borderColor = colors.accent;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderColor = `${colors.accent}44`;
                  }}
                >
                  Ask Pandora →
                </button>
              )}
              {onCreateRule && (
                <button
                  onClick={(e) => { e.stopPropagation(); onCreateRule(finding); }}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 10px',
                    borderRadius: 4,
                    border: `1px solid ${colors.textSecondary}44`,
                    background: 'transparent',
                    color: colors.textSecondary,
                    cursor: 'pointer',
                    fontFamily: fonts.mono,
                    transition: 'background 0.12s, border-color 0.12s, color 0.12s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = `${colors.textSecondary}18`;
                    e.currentTarget.style.borderColor = colors.textSecondary;
                    e.currentTarget.style.color = colors.text;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderColor = `${colors.textSecondary}44`;
                    e.currentTarget.style.color = colors.textSecondary;
                  }}
                >
                  Create Rule →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
