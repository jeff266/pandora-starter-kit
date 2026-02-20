import React from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../../styles/theme';
import { Notification } from '../../hooks/useNotifications';
import { timeAgo } from '../../utils/time';

interface NotificationPanelProps {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClose: () => void;
}

export default function NotificationPanel({
  notifications,
  unreadCount,
  loading,
  error,
  onMarkRead,
  onMarkAllRead,
  onClose,
}: NotificationPanelProps) {
  const navigate = useNavigate();

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) {
      onMarkRead(notification.id);
    }
    if (notification.action_url) {
      navigate(notification.action_url);
    }
    onClose();
  };

  const getNotificationIcon = (type: string): { icon: string; color: string } => {
    switch (type) {
      case 'invite_received':
        return { icon: '👤+', color: colors.accent };
      case 'invite_request_submitted':
        return { icon: '👤', color: colors.yellow };
      case 'invite_request_resolved':
        return { icon: '✓', color: colors.green };
      case 'agent_pending_review':
        return { icon: '🤖', color: colors.yellow };
      case 'agent_review_resolved':
        return { icon: '✓', color: colors.green };
      case 'skill_run_request':
        return { icon: '▶', color: colors.yellow };
      case 'skill_run_resolved':
        return { icon: '✓', color: colors.green };
      case 'member_suspended':
        return { icon: '⚠', color: colors.red };
      case 'role_changed':
        return { icon: '🛡', color: colors.accent };
      default:
        return { icon: '🔔', color: colors.textMuted };
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        width: 380,
        maxHeight: 480,
        background: colors.surfaceRaised,
        border: `1px solid ${colors.borderLight}`,
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        fontFamily: fonts.sans,
        zIndex: 1000,
        animation: 'slideDown 150ms ease-out',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <style>{`
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (max-width: 480px) {
          .notification-panel {
            position: fixed !important;
            top: 0 !important;
            right: 0 !important;
            left: 0 !important;
            width: 100% !important;
            max-height: 100vh !important;
            border-radius: 0 !important;
          }
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
          Notifications
        </span>
        {unreadCount > 0 && (
          <button
            onClick={onMarkAllRead}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 12,
              fontWeight: 500,
              color: colors.accent,
              cursor: 'pointer',
              padding: 0,
              fontFamily: fonts.sans,
            }}
          >
            Mark all read
          </button>
        )}
      </div>

      {/* List */}
      <div
        style={{
          overflowY: 'auto',
          maxHeight: 380,
        }}
      >
        {loading ? (
          <div style={{ padding: 20 }}>
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                style={{
                  padding: '12px 16px',
                  marginBottom: i < 2 ? 1 : 0,
                  background: colors.surface,
                  borderRadius: 6,
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              >
                <div style={{ height: 12, background: colors.surfaceHover, borderRadius: 3, marginBottom: 8 }} />
                <div style={{ height: 10, background: colors.surfaceHover, borderRadius: 3, width: '70%' }} />
              </div>
            ))}
            <style>{`
              @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
              }
            `}</style>
          </div>
        ) : error ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 12 }}>
              Couldn't load notifications
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                fontSize: 12,
                fontWeight: 500,
                color: colors.accent,
                background: colors.accentSoft,
                border: `1px solid ${colors.accent}`,
                borderRadius: 6,
                cursor: 'pointer',
                fontFamily: fonts.sans,
              }}
            >
              Retry
            </button>
          </div>
        ) : notifications.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 48, opacity: 0.3, marginBottom: 12 }}>🔔</div>
            <p style={{ fontSize: 14, color: colors.text, marginBottom: 4 }}>
              You're all caught up
            </p>
            <p style={{ fontSize: 12, color: colors.textMuted }}>
              Notifications will appear here
            </p>
          </div>
        ) : (
          notifications.map((notification, index) => {
            const { icon, color } = getNotificationIcon(notification.type);
            return (
              <div key={notification.id}>
                <div
                  onClick={() => handleNotificationClick(notification)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: '12px 16px',
                    background: notification.read ? 'transparent' : 'rgba(59,130,246,0.06)',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = colors.surfaceHover;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = notification.read
                      ? 'transparent'
                      : 'rgba(59,130,246,0.06)';
                  }}
                >
                  {/* Icon */}
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      color,
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  >
                    {icon}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: notification.read ? 400 : 600,
                        color: colors.text,
                        marginBottom: notification.body ? 4 : 0,
                      }}
                    >
                      {notification.title}
                    </div>
                    {notification.body && (
                      <div
                        style={{
                          fontSize: 12,
                          color: colors.textSecondary,
                          marginBottom: 4,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          lineHeight: 1.4,
                        }}
                      >
                        {notification.body}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: colors.textMuted }}>
                      {timeAgo(notification.created_at)}
                    </div>
                  </div>

                  {/* Unread indicator */}
                  {!notification.read && (
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: colors.accent,
                        flexShrink: 0,
                        marginTop: 6,
                      }}
                    />
                  )}
                </div>
                {index < notifications.length - 1 && (
                  <div style={{ height: 1, background: colors.border }} />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      {!loading && !error && notifications.length > 0 && (
        <div
          style={{
            padding: '12px 20px',
            borderTop: `1px solid ${colors.border}`,
            textAlign: 'center',
          }}
        >
          <button
            onClick={() => {
              navigate('/settings/notifications');
              onClose();
            }}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 12,
              color: colors.textMuted,
              cursor: 'pointer',
              padding: 0,
              fontFamily: fonts.sans,
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = colors.textSecondary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = colors.textMuted;
            }}
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}
