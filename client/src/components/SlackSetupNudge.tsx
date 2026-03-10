import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../styles/theme';
import { api } from '../lib/api';
import { useWorkspace } from '../context/WorkspaceContext';

interface SlackSetupNudgeProps {
  /** Variant changes the message and styling */
  variant?: 'skills' | 'playbooks' | 'assistant' | 'command-center';
  /** Whether to show as banner (full-width) or card (inline) */
  layout?: 'banner' | 'card';
  /** Optional className for custom styling */
  className?: string;
}

const MESSAGES = {
  skills: {
    title: '📬 Get notified when skills complete',
    description: 'Connect Slack to receive automated insights and findings from this skill directly in your channel.',
  },
  playbooks: {
    title: '📬 Automate your workflow with Slack',
    description: 'Connect Slack to receive playbook results, critical alerts, and weekly summaries automatically.',
  },
  assistant: {
    title: '📬 Enable Slack notifications',
    description: 'Get important insights and alerts sent to your Slack channel automatically.',
  },
  'command-center': {
    title: '📬 Stay updated with Slack alerts',
    description: 'Connect Slack to receive pipeline hygiene reports, deal risks, and actionable insights.',
  },
};

export default function SlackSetupNudge({
  variant = 'skills',
  layout = 'card',
  className = '',
}: SlackSetupNudgeProps) {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspace();
  const [slackConnected, setSlackConnected] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    checkSlackConnection();
  }, [currentWorkspace?.id]);

  async function checkSlackConnection() {
    if (!currentWorkspace?.id) return;
    try {
      const workspace = await api.get(`/workspaces/${currentWorkspace.id}`);
      const webhookUrl = workspace?.settings?.slack_webhook_url || '';
      setSlackConnected(!!webhookUrl);
    } catch (err) {
      console.error('Failed to check Slack connection:', err);
      setSlackConnected(false);
    }
  }

  // Don't show if Slack is connected or nudge is dismissed
  if (slackConnected === null || slackConnected || dismissed) {
    return null;
  }

  const message = MESSAGES[variant];

  const isBanner = layout === 'banner';

  return (
    <div
      className={className}
      style={{
        background: `${colors.accent}08`,
        border: `1px solid ${colors.accent}30`,
        borderRadius: isBanner ? 0 : 8,
        padding: isBanner ? '12px 20px' : '16px 20px',
        marginBottom: isBanner ? 0 : 16,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontFamily: fonts.sans,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 2 }}>
          {message.title}
        </div>
        <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.5 }}>
          {message.description}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={() => navigate('/settings/notifications')}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: fonts.sans,
            borderRadius: 6,
            border: 'none',
            background: colors.accent,
            color: '#fff',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Connect Slack
        </button>
        <button
          onClick={() => setDismissed(true)}
          style={{
            padding: '8px 12px',
            fontSize: 13,
            fontWeight: 500,
            fontFamily: fonts.sans,
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            background: 'transparent',
            color: colors.textSecondary,
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
