import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Code2 } from 'lucide-react';
import { colors, fonts } from '../../styles/theme';
import { formatTimeAgo } from '../../lib/format';
import { SeverityDot } from '../shared';
import { useDemoMode } from '../../contexts/DemoModeContext';

interface Finding {
  id: string;
  skill_id: string;
  severity: string;
  message: string;
  deal_name?: string;
  account_name?: string;
  owner_email?: string;
  found_at: string;
}

interface FindingsFeedProps {
  findings?: Finding[];
  loading?: boolean;
  workspaceId: string;
}

export function FindingsFeed({ findings, loading = false, workspaceId }: FindingsFeedProps) {
  const navigate = useNavigate();
  const { anon } = useDemoMode();

  const handleFindingClick = (finding: Finding) => {
    // Navigate to the deal or insights page
    if (finding.deal_name) {
      navigate(`/workspaces/${workspaceId}/deals?finding=${finding.id}`);
    } else {
      navigate(`/workspaces/${workspaceId}/insights`);
    }
  };

  const handleViewAll = () => {
    navigate(`/workspaces/${workspaceId}/insights`);
  };

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 16,
      }}
    >
      {/* Header */}
      <h4 style={{ margin: '0 0 16px 0', fontSize: 16, fontWeight: 600, color: colors.text, fontFamily: fonts.body }}>
        Recent Findings
      </h4>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: colors.textSecondary }}>Loading...</div>
      ) : findings && findings.length > 0 ? (
        <>
          {/* Findings List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            {findings.map((finding) => (
              <button
                key={finding.id}
                onClick={() => handleFindingClick(finding)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 12,
                  borderRadius: 8,
                  border: `1px solid ${colors.border}`,
                  background: colors.bg,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceHover)}
                onMouseLeave={(e) => (e.currentTarget.style.background = colors.bg)}
              >
                {/* Finding Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  {/* Skill Tag + Time */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: colors.surfaceHover,
                        color: colors.textSecondary,
                        fontSize: 11,
                        fontFamily: fonts.mono,
                      }}
                    >
                      <Code2 size={12} />
                      {finding.skill_id}
                    </div>
                    <span style={{ fontSize: 11, color: colors.textSecondary, fontFamily: fonts.body }}>
                      {formatTimeAgo(finding.found_at)}
                    </span>
                  </div>

                  {/* Severity */}
                  <SeverityDot severity={finding.severity} size={10} />
                </div>

                {/* Finding Message */}
                <div style={{ fontSize: 13, color: colors.text, lineHeight: 1.5, fontFamily: fonts.body }}>
                  {anon.text(finding.message)}
                </div>

                {/* Entity Context */}
                {(finding.deal_name || finding.account_name) && (
                  <div style={{ fontSize: 11, color: colors.textSecondary, fontFamily: fonts.body }}>
                    {finding.deal_name && <span>Deal: {anon.deal(finding.deal_name)}</span>}
                    {finding.deal_name && finding.account_name && <span> • </span>}
                    {finding.account_name && <span>Account: {anon.company(finding.account_name)}</span>}
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* View All Button */}
          <button
            onClick={handleViewAll}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              width: '100%',
              padding: '10px 16px',
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: colors.bg,
              color: colors.accent,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              fontFamily: fonts.body,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = colors.bg)}
          >
            View All Findings
            <ArrowRight size={16} />
          </button>
        </>
      ) : (
        <div style={{ padding: 20, textAlign: 'center', color: colors.textSecondary }}>
          No recent findings
        </div>
      )}
    </div>
  );
}
