import React from 'react';
import { BarChart3, TrendingDown, Layout, Table } from 'lucide-react';
import { colors, fonts } from '../../styles/theme';
import { HorizontalBarsChart } from './viz/HorizontalBarsChart';
import type { DashboardPreferences } from '../../hooks/useDashboardPreferences';

interface PipelineStage {
  stage: string;
  stage_normalized?: string;
  deal_count: number;
  total_value: number;
  weighted_value: number;
  probability?: number;
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

interface PipelineChartProps {
  stages?: PipelineStage[];
  vizMode: DashboardPreferences['pipeline_viz_mode'];
  onVizModeChange: (mode: DashboardPreferences['pipeline_viz_mode']) => void;
  loading?: boolean;
  workspaceId: string;
}

export function PipelineChart({ stages, vizMode, onVizModeChange, loading = false, workspaceId }: PipelineChartProps) {
  const vizModes: Array<{
    id: DashboardPreferences['pipeline_viz_mode'];
    label: string;
    icon: React.ReactNode;
    disabled: boolean;
    tooltip?: string;
  }> = [
    {
      id: 'horizontal_bars',
      label: 'Bars',
      icon: <BarChart3 size={18} />,
      disabled: false,
    },
    {
      id: 'funnel',
      label: 'Funnel',
      icon: <TrendingDown size={18} />,
      disabled: true,
      tooltip: 'Coming in Phase 2',
    },
    {
      id: 'kanban',
      label: 'Kanban',
      icon: <Layout size={18} />,
      disabled: true,
      tooltip: 'Coming in Phase 2',
    },
    {
      id: 'table',
      label: 'Table',
      icon: <Table size={18} />,
      disabled: true,
      tooltip: 'Coming in Phase 2',
    },
  ];

  return (
    <div>
      {/* Viz Mode Selector */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: 4,
            background: colors.bg,
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
          }}
        >
          {vizModes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => !mode.disabled && onVizModeChange(mode.id)}
              disabled={mode.disabled}
              title={mode.tooltip}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 6,
                border: 'none',
                background: vizMode === mode.id ? colors.accent : 'transparent',
                color: mode.disabled ? colors.textSecondary : vizMode === mode.id ? '#fff' : colors.text,
                fontSize: 13,
                fontWeight: 500,
                cursor: mode.disabled ? 'not-allowed' : 'pointer',
                opacity: mode.disabled ? 0.5 : 1,
                transition: 'all 0.15s ease',
                fontFamily: fonts.body,
              }}
              onMouseEnter={(e) => {
                if (!mode.disabled && vizMode !== mode.id) {
                  e.currentTarget.style.background = colors.surfaceHover;
                }
              }}
              onMouseLeave={(e) => {
                if (!mode.disabled && vizMode !== mode.id) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              {mode.icon}
              <span>{mode.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Visualization Content */}
      <div>
        {vizMode === 'horizontal_bars' && (
          <HorizontalBarsChart stages={stages || []} loading={loading} workspaceId={workspaceId} />
        )}
        {vizMode === 'funnel' && <div style={{ color: colors.textSecondary }}>Funnel view coming soon...</div>}
        {vizMode === 'kanban' && <div style={{ color: colors.textSecondary }}>Kanban view coming soon...</div>}
        {vizMode === 'table' && <div style={{ color: colors.textSecondary }}>Table view coming soon...</div>}
      </div>
    </div>
  );
}
