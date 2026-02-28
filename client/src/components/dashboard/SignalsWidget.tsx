import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { colors, fonts } from '../../styles/theme';

interface SkillActivitySummary {
  total_runs: number;
  total_findings: number;
  by_skill: Record<string, number>;
}

interface SkillActivityWidgetProps {
  summary?: SkillActivitySummary;
  loading: boolean;
  workspaceId: string;
}

export function SignalsWidget({ summary, loading, workspaceId }: SkillActivityWidgetProps) {
  const navigate = useNavigate();

  const handleViewInsights = () => {
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
        <div style={{ height: 60, background: colors.surfaceRaised, borderRadius: 6 }} />
      </div>
    );
  }

  const totalRuns = summary?.total_runs ?? 0;
  const totalFindings = summary?.total_findings ?? 0;
  const bySkill = summary?.by_skill ?? {};

  // Get top 3 skills by finding count
  const topSkills = Object.entries(bySkill)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 3);

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
          <span style={{ fontSize: 15 }}>⚡</span>
          <span style={{
            fontSize: 13,
            fontWeight: 600,
            color: colors.text,
            fontFamily: fonts.sans,
          }}>
            Skill Activity
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: 16 }}>
        {totalRuns === 0 && totalFindings === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '20px 0',
            color: colors.textMuted,
            fontSize: 13,
            fontFamily: fonts.sans,
          }}>
            No skill activity this week
          </div>
        ) : (
          <>
            {/* Stats Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div style={{
                padding: 12,
                borderRadius: 6,
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
              }}>
                <div style={{ fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, fontFamily: fonts.sans }}>
                  Skill Runs
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: fonts.mono, color: colors.accent }}>
                  {totalRuns}
                </div>
              </div>

              <div style={{
                padding: 12,
                borderRadius: 6,
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
              }}>
                <div style={{ fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, fontFamily: fonts.sans }}>
                  Findings
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: fonts.mono, color: colors.text }}>
                  {totalFindings}
                </div>
              </div>
            </div>

            {/* Top Skills */}
            {topSkills.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 8, fontFamily: fonts.sans }}>
                  Top Skills This Week
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {topSkills.map(([skillId, count]) => (
                    <div key={skillId} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: 6,
                      borderRadius: 4,
                      background: colors.surfaceHover,
                    }}>
                      <span style={{ fontSize: 11, color: colors.text, fontFamily: fonts.mono }}>
                        {skillId}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 600, fontFamily: fonts.mono, color: colors.textSecondary }}>
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* View Insights Button */}
            <button
              onClick={handleViewInsights}
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
              View All Insights
              <ArrowRight size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
