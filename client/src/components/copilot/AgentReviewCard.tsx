import React from 'react';
import { colors, fonts } from '../../styles/theme';
import { Check, Edit3, RotateCcw } from 'lucide-react';
import type { DraftConfig } from './copilot-steps';
import AvatarDisplay from '../avatars/AvatarDisplay';

interface Props {
  config: DraftConfig;
  onConfirm: () => void;
  onEdit: () => void;
  onStartOver: () => void;
  isCreating: boolean;
}

function formatSchedule(schedule?: DraftConfig['schedule']): string {
  if (!schedule) return 'Not set';
  if (schedule.type === 'manual') return 'Manual (on-demand)';
  if (schedule.cron) {
    const cronMap: Record<string, string> = {
      '0 8 * * 1': 'Every Monday at 8 AM',
      '0 8 * * 1-5': 'Every weekday at 8 AM',
      '0 8 * * 1,4': 'Mon & Thu at 8 AM',
      '0 7 * * 1': 'Every Monday at 7 AM',
      '0 16 * * 4': 'Every Thursday at 4 PM',
      '0 17 * * 5': 'Every Friday at 5 PM',
      '0 8 * * *': 'Daily at 8 AM',
    };
    return cronMap[schedule.cron] || schedule.cron;
  }
  return 'Not set';
}

export default function AgentReviewCard({ config, onConfirm, onEdit, onStartOver, isCreating }: Props) {
  return (
    <div style={{
      border: `1px solid ${colors.border}`,
      borderRadius: 12,
      background: colors.surface,
      overflow: 'hidden',
      marginBottom: 12,
    }}>
      <div style={{
        padding: '16px 20px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <AvatarDisplay value={config.icon} size={32} fallbackEmoji={'\u{1F916}'} borderRadius={8} />
        <span style={{ font: `600 16px ${fonts.sans}`, color: colors.text }}>
          {config.name || 'New Agent'}
        </span>
      </div>

      <div style={{ padding: '16px 20px' }}>
        <ReviewRow label="Audience" value={
          config.audience
            ? `${config.audience.role} (${config.audience.detail_preference})`
            : 'Not set'
        } />
        <ReviewRow label="Focus" value={
          config.focus_questions?.length
            ? config.focus_questions.map((q, i) => `${i + 1}. ${q}`).join('\n')
            : 'Not set'
        } multiline />
        <ReviewRow label="Skills" value={
          config.skills?.length
            ? config.skills.join(', ')
            : 'Not set'
        } />
        <ReviewRow label="Schedule" value={formatSchedule(config.schedule)} />
        <ReviewRow label="Delivery" value={
          config.output_formats?.length
            ? config.output_formats.join(', ')
            : 'Not set'
        } />
        {config.slack_channel && (
          <ReviewRow label="Slack Channel" value={config.slack_channel} />
        )}
      </div>

      <div style={{
        padding: '12px 20px',
        borderTop: `1px solid ${colors.border}`,
        display: 'flex',
        gap: 8,
      }}>
        <button
          onClick={onConfirm}
          disabled={isCreating}
          style={{
            flex: 1,
            padding: '10px 16px',
            borderRadius: 8,
            border: 'none',
            background: colors.accent,
            color: '#fff',
            font: `500 14px ${fonts.sans}`,
            cursor: isCreating ? 'not-allowed' : 'pointer',
            opacity: isCreating ? 0.6 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Check size={16} />
          {isCreating ? 'Creating...' : 'Create Agent'}
        </button>
        <button
          onClick={onEdit}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            background: 'transparent',
            color: colors.text,
            font: `400 14px ${fonts.sans}`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Edit3 size={14} /> Edit
        </button>
        <button
          onClick={onStartOver}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            background: 'transparent',
            color: colors.textMuted,
            font: `400 14px ${fonts.sans}`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <RotateCcw size={14} /> Start Over
        </button>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      gap: 12,
      padding: '8px 0',
      borderBottom: `1px solid ${colors.border}`,
    }}>
      <span style={{
        font: `500 13px ${fonts.sans}`,
        color: colors.textMuted,
        minWidth: 90,
        flexShrink: 0,
      }}>
        {label}
      </span>
      <span style={{
        font: `400 13px ${fonts.sans}`,
        color: colors.text,
        whiteSpace: multiline ? 'pre-wrap' : 'normal',
        lineHeight: 1.5,
      }}>
        {value}
      </span>
    </div>
  );
}
