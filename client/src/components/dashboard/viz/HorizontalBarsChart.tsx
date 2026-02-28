import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { colors, fonts } from '../../../styles/theme';
import { formatCurrency, formatNumber, severityColor } from '../../../lib/format';
import { SeverityDot } from '../../shared';

interface PipelineStage {
  stage: string;
  stage_normalized?: string;
  deal_count: number;
  total_value: number;
  weighted_value: number;
  findings?: {
    act: number;
    watch: number;
    notable: number;
    info?: number;
    top_findings?: Array<{
      severity: string;
      category: string;
      message: string;
      deal_id: string;
    }>;
  };
}

interface HorizontalBarsChartProps {
  stages: PipelineStage[];
  loading?: boolean;
  workspaceId: string;
}

export function HorizontalBarsChart({ stages, loading = false, workspaceId }: HorizontalBarsChartProps) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div
        style={{
          height: 400,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: colors.textSecondary,
        }}
      >
        Loading pipeline...
      </div>
    );
  }

  if (!stages || stages.length === 0) {
    return (
      <div
        style={{
          height: 400,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: colors.textSecondary,
        }}
      >
        No pipeline data available
      </div>
    );
  }

  // Generate stage colors (blue gradient)
  const getBarColor = (index: number) => {
    const blues = ['#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe'];
    return blues[index % blues.length];
  };

  const handleBarClick = (stage: PipelineStage) => {
    // Navigate to deals page filtered by this stage
    navigate(`/workspaces/${workspaceId}/deals?stage=${encodeURIComponent(stage.stage)}`);
  };

  const handleFlagClick = (stage: PipelineStage, severity: string) => {
    // Navigate to deals page filtered by stage and finding severity
    navigate(
      `/workspaces/${workspaceId}/deals?stage=${encodeURIComponent(stage.stage)}&finding_severity=${severity}`
    );
  };

  return (
    <div>
      {/* Recharts Bar Chart */}
      <ResponsiveContainer width="100%" height={400}>
        <BarChart
          data={stages}
          layout="vertical"
          margin={{ top: 10, right: 30, left: 120, bottom: 10 }}
          onClick={(e: any) => {
            if (e?.activePayload?.[0]?.payload) {
              handleBarClick(e.activePayload[0].payload);
            }
          }}
        >
          <XAxis
            type="number"
            tickFormatter={(value) => formatCurrency(value)}
            stroke={colors.textSecondary}
            style={{ fontSize: 12, fontFamily: fonts.body }}
          />
          <YAxis
            type="category"
            dataKey="stage"
            width={110}
            stroke={colors.textSecondary}
            style={{ fontSize: 12, fontFamily: fonts.body }}
          />
          <Tooltip
            cursor={{ fill: colors.surfaceHover }}
            contentStyle={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
              fontFamily: fonts.body,
            }}
            formatter={((value: any, name: string) => {
              if (name === 'total_value') return [formatCurrency(value), 'Total Value'];
              return [value, name];
            }) as any}
          />
          <Bar
            dataKey="total_value"
            radius={[0, 8, 8, 0]}
            style={{ cursor: 'pointer' }}
          >
            {stages.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getBarColor(index)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Stage Findings Annotations */}
      <div style={{ marginTop: 20, paddingLeft: 120 }}>
        {stages.map((stage, index) => {
          const findings = stage.findings;
          const hasFindings = findings && (findings.act > 0 || findings.watch > 0);

          if (!hasFindings) return null;

          return (
            <div
              key={stage.stage}
              style={{
                marginBottom: 16,
                paddingBottom: 12,
                borderBottom: index < stages.length - 1 ? `1px solid ${colors.border}` : 'none',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
                {stage.stage} - {formatNumber(stage.deal_count)} deals, {formatCurrency(stage.total_value)}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {findings.act > 0 && (
                  <button
                    onClick={() => handleFlagClick(stage, 'act')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: 'none',
                      background: `${colors.red}22`,
                      color: colors.red,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      fontFamily: fonts.body,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = `${colors.red}33`)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = `${colors.red}22`)}
                  >
                    <SeverityDot severity="act" size={8} />
                    {findings.act} critical
                  </button>
                )}

                {findings.watch > 0 && (
                  <button
                    onClick={() => handleFlagClick(stage, 'watch')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: 'none',
                      background: `${colors.yellow}22`,
                      color: colors.yellow,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      fontFamily: fonts.body,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = `${colors.yellow}33`)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = `${colors.yellow}22`)}
                  >
                    <SeverityDot severity="watch" size={8} />
                    {findings.watch} warning
                  </button>
                )}

                {findings.notable > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 10px',
                      color: colors.textSecondary,
                      fontSize: 12,
                      fontFamily: fonts.body,
                    }}
                  >
                    <SeverityDot severity="notable" size={8} />
                    {findings.notable} notable
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
