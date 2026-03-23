import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../../styles/theme';
import { useNotifications } from '../../hooks/useNotifications';
import { api } from '../../lib/api';
import NotificationPanel from './NotificationPanel';
import type { ActionItem } from './NotificationPanel';

interface NotificationBellProps {
  workspaceId: string;
}

const DISMISS_KEY_CALIBRATION = 'pandora_calibration_banner_dismissed';
const DISMISS_KEY_PUSH        = 'pandora_push_banner_dismissed';

export default function NotificationBell({ workspaceId }: NotificationBellProps) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [prevCount, setPrevCount] = useState(0);
  const [shouldPulse, setShouldPulse] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  const { notifications, unreadCount, loading, error, markRead, markAllRead } = useNotifications(workspaceId);

  // --- Action items state ---
  const [calStatus, setCalStatus]   = useState<'not_started' | 'in_progress' | 'complete' | null>(null);
  const [hasRules, setHasRules]     = useState<boolean | null>(null);
  const [calDismissed, setCalDismissed]   = useState(() => localStorage.getItem(DISMISS_KEY_CALIBRATION) === 'true');
  const [pushDismissed, setPushDismissed] = useState(() => localStorage.getItem(DISMISS_KEY_PUSH) === 'true');

  useEffect(() => {
    if (!workspaceId) return;
    if (!calDismissed) {
      api.get('/calibration-status').then((d: any) => {
        setCalStatus(d.status ?? 'not_started');
      }).catch(() => {});
    }
    if (!pushDismissed) {
      api.get('/push/rules').then((d: any) => {
        const rules = d.rules || [];
        setHasRules(rules.some((r: any) => r.is_active));
      }).catch(() => {});
    }
  }, [workspaceId, calDismissed, pushDismissed]);

  const dismissCal = useCallback(() => {
    setCalDismissed(true);
    localStorage.setItem(DISMISS_KEY_CALIBRATION, 'true');
  }, []);

  const dismissPush = useCallback(() => {
    setPushDismissed(true);
    localStorage.setItem(DISMISS_KEY_PUSH, 'true');
  }, []);

  // Build action items list
  const actionItems: ActionItem[] = [];

  if (!calDismissed && calStatus && calStatus !== 'complete') {
    const isInProgress = calStatus === 'in_progress';
    actionItems.push({
      id: 'calibration',
      icon: '⚠',
      accentColor: '#f59e0b',
      title: isInProgress ? 'Calibration in progress' : 'Pipeline not calibrated',
      body: isInProgress
        ? 'Finish setting up your pipeline definitions so Pandora can give accurate numbers.'
        : "Pipeline and forecast numbers may not match your CRM until calibration is complete.",
      actionLabel: isInProgress ? 'Continue calibration' : 'Set up calibration',
      onAction: () => { navigate('/settings/calibration'); setIsOpen(false); },
      onDismiss: dismissCal,
    });
  }

  if (!pushDismissed && hasRules === false) {
    actionItems.push({
      id: 'slack',
      icon: '📣',
      accentColor: colors.accent,
      title: 'Stay updated with Slack alerts',
      body: 'Receive pipeline hygiene reports, deal risks, and actionable insights in Slack.',
      actionLabel: 'Set up delivery rules',
      onAction: () => { navigate('/push'); setIsOpen(false); },
      onDismiss: dismissPush,
    });
  }

  // Pulse animation when new notifications arrive
  const totalCount = unreadCount + actionItems.length;
  useEffect(() => {
    if (totalCount > prevCount && prevCount > 0) {
      setShouldPulse(true);
      setTimeout(() => setShouldPulse(false), 600);
    }
    setPrevCount(totalCount);
  }, [totalCount, prevCount]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen]);

  const badgeCount = totalCount <= 9 ? totalCount.toString() : '9+';

  return (
    <div ref={bellRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'relative',
          width: 36,
          height: 36,
          padding: 0,
          background: 'transparent',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = colors.surfaceHover; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        aria-label="Notifications"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke={totalCount > 0 ? colors.text : colors.textMuted}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transition: 'stroke 0.15s' }}
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {totalCount > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              background: actionItems.length > 0 && unreadCount === 0 ? '#f59e0b' : colors.red,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 600,
              color: '#fff',
              fontFamily: fonts.sans,
              animation: shouldPulse ? 'badgePulse 0.6s ease-out' : 'none',
            }}
          >
            {badgeCount}
          </div>
        )}
      </button>

      {isOpen && (
        <NotificationPanel
          notifications={notifications}
          unreadCount={unreadCount}
          loading={loading}
          error={error}
          onMarkRead={markRead}
          onMarkAllRead={markAllRead}
          onClose={() => setIsOpen(false)}
          actionItems={actionItems}
        />
      )}

      <style>{`
        @keyframes badgePulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
