import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { colors, fonts } from '../../styles/theme';

interface FindingsSummary {
  total_this_week: number;
  act_count: number;
  watch_count: number;
  notable_count: number;
  info_count: number;
}

interface FindingsWidgetProps {
  summary?: FindingsSummary;
  loading: boolean;
  workspaceId: string;
}

export function ActionsWidget({ summary, loading, workspaceId }: FindingsWidgetProps) {
  const navigate = useNavigate();

  const handleViewAll = () => {
    navigate(`/workspaces/${workspaceId}/insights`);
  };

  if (loading) {
    return (
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 16,
      }}>
        <div style={{ height: 14, background: colors.surfaceHover, borderRadius: 4, width: '60%', marginBottom: 12 }} />
        <div style={{ height: 40, background: colors.surfaceRaised, borderRadius: 6 }} />
      </div>
    );
  }

  const totalFindings = summary?.total_this_week ?? 0;
  const actCount = summary?.act_count ?? 0;
  const watchCount = summary?.watch_count ?? 0;

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px',
        borderBottom: `1px solid ${colors.border}`,
        background: colors.surfaceRaised,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 15 }}>🎯</span>
          <span style={{
            fontSize: 13,
            fontWeight: 600,
            color: colors.text,
            fontFamily: fonts.sans,
          }}>
            Critical Findings
          </span>
          {totalFindings > 0 && (
            <span style={{
              fontSize: 11,
              padding: '2px 8px',
              background: colors.surfaceHover,
              color: colors.textSecondary,
              borderRadius: 10,
              fontWeight: 500,
              fontFamily: fonts.sans,
            }}>
              {totalFindings} this week
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: 16 }}>
        {totalFindings === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '20px 0',
            color: colors.textMuted,
            fontSize: 13,
            fontFamily: fonts.sans,
          }}>
            No critical findings this week
          </div>
        ) : (
          <>
            {/* Severity Breakdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {actCount > 0 && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 8,
                  borderRadius: 6,
                  background: colors.redSoft,
                  border: `1px solid ${colors.red}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12 }}>🔴</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: colors.text, fontFamily: fonts.sans }}>
                      Requires Action
                    </span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, fontFamily: fonts.mono, color: colors.red }}>
                    {actCount}
                  </span>
                </div>
              )}

              {watchCount > 0 && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 8,
                  borderRadius: 6,
                  background: colors.yellowSoft,
                  border: `1px solid ${colors.yellow}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12 }}>⚠️</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: colors.text, fontFamily: fonts.sans }}>
                      Watch Closely
                    </span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, fontFamily: fonts.mono, color: colors.yellow }}>
                    {watchCount}
                  </span>
                </div>
              )}
            </div>

            {/* View All Button */}
            <button
              onClick={handleViewAll}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                background: colors.bg,
                color: colors.accent,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                fontFamily: fonts.sans,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = colors.bg)}
            >
              View All Findings
              <ArrowRight size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
