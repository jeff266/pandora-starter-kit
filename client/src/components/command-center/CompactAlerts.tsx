import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';
import { useDemoMode } from '../../contexts/DemoModeContext';
import { useWorkspace } from '../../context/WorkspaceContext';

interface CompactAlertsProps {
  workspaceId: string;
  period?: string;
}

interface Finding {
  id: string;
  severity: 'act' | 'watch' | 'notable' | 'info';
  category: string;
  message: string;
  summary?: string;
  deal_id?: string;
  deal_name?: string;
  owner_name?: string;
  skill_name?: string;
  created_at: string;
}

const SEVERITY_CONFIG = {
  act: {
    accent: colors.red,
    bg: colors.redSoft,
    icon: '🔴',
    textColor: '#fca5a5',
  },
  watch: {
    accent: colors.yellow,
    bg: colors.yellowSoft,
    icon: '⚠️',
    textColor: '#fde68a',
  },
  notable: {
    accent: colors.accent,
    bg: colors.accentSoft,
    icon: 'ℹ️',
    textColor: '#93c5fd',
  },
  info: {
    accent: colors.accent,
    bg: colors.accentSoft,
    icon: 'ℹ️',
    textColor: '#93c5fd',
  },
};

function CompactAlertCard({ finding, onDismiss, onCreateTask }: {
  finding: Finding;
  onDismiss: (id: string) => void;
  onCreateTask: (id: string) => void;
}) {
  const { anon } = useDemoMode();
  const navigate = useNavigate();
  const config = SEVERITY_CONFIG[finding.severity];
  const [dismissing, setDismissing] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);

  const handleDismiss = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissing(true);
    try {
      await api.patch(`/findings/${finding.id}/resolve`, { resolution_method: 'user_dismissed' });
      onDismiss(finding.id);

      const event = new CustomEvent('toast', {
        detail: {
          message: 'Alert dismissed',
          type: 'success',
        },
      });
      window.dispatchEvent(event);
    } catch (err) {
      console.error('Failed to dismiss:', err);
    } finally {
      setDismissing(false);
    }
  };

  const handleCreateTask = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!finding.deal_id) return;

    setCreatingTask(true);
    try {
      // Use the category-derived task title from Part 2 Fix 4
      const taskTitle = getTaskTitleFromCategory(finding.category, finding);

      await api.post(`/deals/${finding.deal_id}/actions/sync`, {
        steps: [{
          title: taskTitle,
          priority: 'P0',
          source: 'client_rule',
          category: finding.category,
          suggested_crm_action: 'task_create',
        }],
      });

      onCreateTask(finding.id);

      const event = new CustomEvent('toast', {
        detail: {
          message: 'Task created',
          type: 'success',
        },
      });
      window.dispatchEvent(event);
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setCreatingTask(false);
    }
  };

  const getTaskTitleFromCategory = (category: string, f: Finding): string => {
    const taskTitleFromCategory: Record<string, string> = {
      'stale_deal': 'Re-engage deal — no activity in 30+ days',
      'single_thread': 'Add second contact to reduce single-thread risk',
      'close_date_risk': 'Review close date — timeline may have shifted',
      'missing_amount': 'Update deal amount in CRM',
      'no_economic_buyer': 'Confirm economic buyer before advancing stage',
      'stage_velocity': 'Review deal velocity — stuck in stage',
      'meddic_coverage': 'Address MEDDIC coverage gaps',
      'quota_not_configured': 'Configure quota in settings',
      'forecast_gap': 'Review forecast gap',
    };

    return taskTitleFromCategory[category] || `Review and address: ${f.message}`;
  };

  return (
    <div
      style={{
        background: colors.surfaceRaised,
        border: `1px solid ${colors.border}`,
        borderLeft: `3px solid ${config.accent}`,
        borderRadius: 6,
        padding: '8px 12px',
        marginBottom: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>{config.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: config.textColor,
              lineHeight: 1.4,
              fontFamily: fonts.sans,
              marginBottom: 2,
            }}
          >
            {anon.text(finding.message)}
          </div>
          {(finding.skill_name || finding.owner_name) && (
            <div
              style={{
                fontSize: 11,
                color: colors.textSecondary,
                lineHeight: 1.5,
                marginTop: 2,
                fontFamily: fonts.sans,
              }}
            >
              {finding.skill_name && `${finding.skill_name}`}
              {finding.skill_name && finding.owner_name && ' · '}
              {finding.owner_name && `Owner: ${anon.text(finding.owner_name)}`}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {finding.deal_id && (
              <button
                onClick={() => navigate(`/deals/${finding.deal_id}`)}
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: 'transparent',
                  color: colors.accent,
                  border: `1px solid ${colors.accent}40`,
                  cursor: 'pointer',
                  fontFamily: fonts.sans,
                }}
              >
                Open Deal
              </button>
            )}
            {finding.deal_id && (
              <button
                onClick={handleCreateTask}
                disabled={creatingTask}
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: colors.accentSoft,
                  color: colors.accent,
                  border: 'none',
                  cursor: creatingTask ? 'not-allowed' : 'pointer',
                  opacity: creatingTask ? 0.5 : 1,
                  fontFamily: fonts.sans,
                }}
              >
                {creatingTask ? 'Creating...' : 'Create Task'}
              </button>
            )}
            <button
              onClick={handleDismiss}
              disabled={dismissing}
              style={{
                fontSize: 11,
                fontWeight: 500,
                padding: '3px 8px',
                borderRadius: 4,
                background: 'transparent',
                color: colors.textSecondary,
                border: `1px solid ${colors.border}`,
                cursor: dismissing ? 'not-allowed' : 'pointer',
                opacity: dismissing ? 0.5 : 1,
                fontFamily: fonts.sans,
              }}
            >
              {dismissing ? 'Dismissing...' : 'Dismiss'}
            </button>

            {/* Context-specific buttons */}
            {finding.category === 'quota_not_configured' && (
              <button
                onClick={() => navigate('/settings/quotas')}
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: colors.accentSoft,
                  color: colors.accent,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: fonts.sans,
                }}
              >
                Configure Quota →
              </button>
            )}
            {finding.category === 'forecast_gap' && (
              <button
                onClick={() => navigate('/forecast')}
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: colors.accentSoft,
                  color: colors.accent,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: fonts.sans,
                }}
              >
                View Forecast →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CompactAlerts({ workspaceId }: CompactAlertsProps) {
  const { currentWorkspace } = useWorkspace();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFindings();
  }, [workspaceId]);

  const fetchFindings = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/${workspaceId}/findings?context=command_center&limit=5`);
      setFindings(response.findings || []);
    } catch (err) {
      console.error('[CompactAlerts] Failed to fetch findings:', err);
      setFindings([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = (findingId: string) => {
    setFindings(prev => prev.filter(f => f.id !== findingId));
  };

  const handleCreateTask = (findingId: string) => {
    // Keep finding in list after task created
  };

  if (loading) {
    return (
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div style={{ height: 14, background: colors.surfaceHover, borderRadius: 4, width: '30%' }} />
        <div style={{ height: 44, background: colors.surfaceRaised, borderRadius: 6, marginTop: 10 }} />
        <div style={{ height: 44, background: colors.surfaceRaised, borderRadius: 6, marginTop: 6 }} />
      </div>
    );
  }

  // Hide section when 0 alerts
  if (findings.length === 0) {
    return null;
  }

  const actCount = findings.filter(f => f.severity === 'act').length;

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 16px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.surfaceRaised,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 15 }}>✨</span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: colors.text,
              fontFamily: fonts.sans,
            }}
          >
            AI Alerts
          </span>
          {actCount > 0 && (
            <span
              style={{
                fontSize: 11,
                padding: '2px 8px',
                background: colors.redSoft,
                color: colors.red,
                borderRadius: 10,
                fontWeight: 500,
                fontFamily: fonts.sans,
              }}
            >
              {actCount} critical
            </span>
          )}
        </div>
        <a
          href="/insights"
          style={{
            fontSize: 12,
            color: colors.accent,
            textDecoration: 'none',
            fontWeight: 500,
            fontFamily: fonts.sans,
          }}
        >
          View all insights →
        </a>
      </div>

      <div style={{ padding: 12 }}>
        {findings.map(finding => (
          <CompactAlertCard
            key={finding.id}
            finding={finding}
            onDismiss={handleDismiss}
            onCreateTask={handleCreateTask}
          />
        ))}
      </div>
    </div>
  );
}
