import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../../context/WorkspaceContext';
import { colors, fonts } from '../../styles/theme';

interface SetupStatus {
  crm_connected: boolean;
  conversation_connected: boolean;
  icp_configured: boolean;
  team_invited: boolean;
  slack_configured: boolean;
  targets_set: boolean;
  first_skill_run: boolean;
  roster_configured: boolean;
  benchmarks_run: boolean;
}

interface ChecklistItem {
  key: keyof SetupStatus;
  title: string;
  description: string;
  action: string;
  navigate?: string;
  settingsTab?: string;
}

const CHECKLIST: ChecklistItem[] = [
  {
    key: 'crm_connected',
    title: 'Connect your CRM',
    description: 'Link HubSpot or Salesforce so Pandora can read your deals, accounts, and contacts.',
    action: 'Go to Connectors →',
    navigate: '/connectors',
  },
  {
    key: 'conversation_connected',
    title: 'Connect conversation intelligence',
    description: 'Add Gong or Fireflies to unlock call analysis, competitive mentions, and buyer signal detection.',
    action: 'Go to Connectors →',
    navigate: '/connectors',
  },
  {
    key: 'icp_configured',
    title: 'Configure your ICP Profile',
    description: 'Define your Ideal Customer Profile criteria so Pandora can score accounts A–F and prioritize your pipeline.',
    action: 'Configure ICP →',
    navigate: '/icp-profile',
  },
  {
    key: 'roster_configured',
    title: 'Set up your sales roster',
    description: 'Define your rep hierarchy and reporting lines so manager-level views and scorecards work correctly.',
    action: 'Set up roster →',
    settingsTab: 'sales-roster',
  },
  {
    key: 'team_invited',
    title: 'Invite your team',
    description: 'Add your reps and managers so everyone can access their own dashboards and findings.',
    action: 'Invite members →',
    settingsTab: 'members',
  },
  {
    key: 'slack_configured',
    title: 'Set up Slack alerts',
    description: 'Connect a Slack channel to receive critical findings and weekly pipeline summaries.',
    action: 'Configure Slack →',
    settingsTab: 'notifications',
  },
  {
    key: 'targets_set',
    title: 'Set quota targets',
    description: 'Upload or enter revenue targets by rep and period to enable attainment tracking and forecasting.',
    action: 'Set targets →',
    navigate: '/targets',
  },
  {
    key: 'first_skill_run',
    title: 'Run your first analysis',
    description: 'Trigger a Playbook or Skill to generate your first findings — this is when Pandora comes alive.',
    action: 'Go to Playbooks →',
    navigate: '/playbooks',
  },
  {
    key: 'benchmarks_run',
    title: 'Compute stage velocity benchmarks',
    description: 'Run the Stage Velocity skill to establish median time-in-stage baselines for your team.',
    action: 'View benchmarks →',
    navigate: '/benchmarks',
  },
];

export default function SetupChecklistTab() {
  const navigate = useNavigate();
  const { currentWorkspace, token } = useWorkspace();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentWorkspace?.id || !token) return;
    fetch(`/api/workspaces/${currentWorkspace.id}/setup-status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setStatus(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentWorkspace?.id, token]);

  const completed = status ? CHECKLIST.filter(i => status[i.key]).length : 0;
  const total = CHECKLIST.length;
  const allDone = completed === total;

  const handleAction = (item: ChecklistItem) => {
    if (item.navigate) {
      navigate(item.navigate);
    } else if (item.settingsTab) {
      navigate(`/settings/${item.settingsTab}`);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '32px 0', color: colors.textMuted, fontSize: 13, fontFamily: fonts.sans }}>
        Loading setup status…
      </div>
    );
  }

  return (
    <div style={{ fontFamily: fonts.sans, maxWidth: 680 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: colors.text, margin: '0 0 6px' }}>
          Admin Setup Guide
        </h2>
        <p style={{ fontSize: 13, color: colors.textMuted, margin: 0 }}>
          Complete these steps to get your workspace fully configured. Steps can be done in any order.
        </p>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary }}>
            {allDone ? 'Setup complete' : `${completed} of ${total} complete`}
          </span>
          <span style={{ fontSize: 12, color: colors.textMuted }}>
            {Math.round((completed / total) * 100)}%
          </span>
        </div>
        <div style={{ height: 6, background: colors.surfaceHover, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 4,
            background: allDone ? colors.green : colors.accent,
            width: `${(completed / total) * 100}%`,
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      {/* All done state */}
      {allDone && (
        <div style={{
          padding: '16px 20px', borderRadius: 10,
          background: colors.greenSoft ?? colors.accentSoft,
          border: `1px solid ${colors.green}`,
          marginBottom: 24,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 20 }}>✓</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.green }}>Your workspace is fully configured</div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
              All setup steps are complete. Pandora is running analysis on your pipeline.
            </div>
          </div>
        </div>
      )}

      {/* Checklist */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {CHECKLIST.map((item) => {
          const done = status?.[item.key] ?? false;
          return (
            <div
              key={item.key}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                padding: '14px 16px', borderRadius: 10,
                border: `1px solid ${done ? colors.border : colors.border}`,
                background: done ? colors.surface : colors.bg,
                opacity: done ? 0.65 : 1,
                transition: 'opacity 0.2s',
              }}
            >
              {/* Completion indicator */}
              <div style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: done ? colors.green : 'transparent',
                border: done ? 'none' : `2px solid ${colors.border}`,
                transition: 'all 0.2s',
              }}>
                {done && <span style={{ fontSize: 12, color: '#fff', fontWeight: 700 }}>✓</span>}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 3 }}>
                  {item.title}
                </div>
                <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.5 }}>
                  {item.description}
                </div>
              </div>

              {/* Action */}
              {!done && (
                <button
                  onClick={() => handleAction(item)}
                  style={{
                    flexShrink: 0, padding: '5px 12px', fontSize: 11, fontWeight: 600,
                    fontFamily: fonts.sans, border: `1px solid ${colors.accent}`,
                    borderRadius: 6, background: colors.accentSoft, color: colors.accent,
                    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = colors.accent;
                    (e.currentTarget as HTMLButtonElement).style.color = '#fff';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = colors.accentSoft;
                    (e.currentTarget as HTMLButtonElement).style.color = colors.accent;
                  }}
                >
                  {item.action}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Help footer */}
      <div style={{ marginTop: 28, padding: '12px 16px', borderRadius: 8, background: colors.surface, border: `1px solid ${colors.border}` }}>
        <div style={{ fontSize: 12, color: colors.textMuted }}>
          <strong style={{ color: colors.textSecondary }}>Need help?</strong> Ask the Pandora assistant — open it from the sidebar and type "how do I..." for any setup question.
        </div>
      </div>
    </div>
  );
}
