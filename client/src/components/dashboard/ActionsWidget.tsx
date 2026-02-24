import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, AlertTriangle, Info, ArrowRight } from 'lucide-react';
import { colors, fonts } from '../../styles/theme';
import { formatCurrency } from '../../lib/format';
import { SeverityDot } from '../shared';

interface ActionsSummary {
  total_open: number;
  critical: number;
  critical_amount: number;
  warning: number;
  warning_amount: number;
  info: number;
  top_actions?: Array<{
    id: string;
    title: string;
    severity: string;
    target_entity_name?: string;
    impact_amount?: number;
  }>;
}

interface ActionsWidgetProps {
  summary?: ActionsSummary;
  loading?: boolean;
  workspaceId: string;
}

export function ActionsWidget({ summary, loading = false, workspaceId }: ActionsWidgetProps) {
  const navigate = useNavigate();

  const handleSeverityClick = (severity: string) => {
    navigate(`/workspaces/${workspaceId}/actions?severity=${severity}`);
  };

  const handleViewAll = () => {
    navigate(`/workspaces/${workspaceId}/actions`);
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
        Actions Needing Attention
      </h4>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: colors.textSecondary }}>Loading...</div>
      ) : (
        <>
          {/* Severity Counts */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            {/* Critical */}
            <button
              onClick={() => handleSeverityClick('critical')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 12,
                borderRadius: 8,
                border: 'none',
                background: `${colors.red}11`,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = `${colors.red}22`)}
              onMouseLeave={(e) => (e.currentTarget.style.background = `${colors.red}11`)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertCircle size={18} color={colors.red} />
                <span style={{ fontSize: 14, fontWeight: 500, color: colors.red, fontFamily: fonts.body }}>
                  {summary?.critical || 0} Critical
                </span>
              </div>
              {summary && summary.critical_amount > 0 && (
                <span style={{ fontSize: 13, color: colors.red, fontFamily: fonts.body }}>
                  {formatCurrency(summary.critical_amount)} at risk
                </span>
              )}
            </button>

            {/* Warning */}
            <button
              onClick={() => handleSeverityClick('high')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 12,
                borderRadius: 8,
                border: 'none',
                background: `${colors.yellow}11`,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = `${colors.yellow}22`)}
              onMouseLeave={(e) => (e.currentTarget.style.background = `${colors.yellow}11`)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={18} color={colors.yellow} />
                <span style={{ fontSize: 14, fontWeight: 500, color: colors.yellow, fontFamily: fonts.body }}>
                  {summary?.warning || 0} Warning
                </span>
              </div>
              {summary && summary.warning_amount > 0 && (
                <span style={{ fontSize: 13, color: colors.yellow, fontFamily: fonts.body }}>
                  {formatCurrency(summary.warning_amount)} at risk
                </span>
              )}
            </button>

            {/* Info */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: 12,
                borderRadius: 8,
                background: `${colors.accent}11`,
              }}
            >
              <Info size={18} color={colors.accent} />
              <span style={{ fontSize: 14, color: colors.textSecondary, fontFamily: fonts.body }}>
                {summary?.info || 0} Info
              </span>
            </div>
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
            View All {summary?.total_open || 0} Actions
            <ArrowRight size={16} />
          </button>
        </>
      )}
    </div>
  );
}
