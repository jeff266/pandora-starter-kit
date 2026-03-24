import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';

interface ReportsBellProps {
  workspaceId: string;
}

const POLL_INTERVAL_MS = 60_000;

export default function ReportsBell({ workspaceId }: ReportsBellProps) {
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const [hovered, setHovered] = useState(false);

  const fetchUnreadCount = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const data = await api.get('/reports/documents/unread-count');
      setUnreadCount(data?.count ?? 0);
    } catch {
      // silently ignore — not critical
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  function handleClick() {
    setUnreadCount(0);
    navigate('/reports');
  }

  const badgeLabel = unreadCount <= 9 ? String(unreadCount) : '9+';

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={`Reports${unreadCount > 0 ? ` — ${unreadCount} unread` : ''}`}
        style={{
          position: 'relative',
          width: 36,
          height: 36,
          padding: 0,
          background: hovered ? colors.surfaceHover : 'transparent',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.15s',
        }}
      >
        <FileText
          width={20}
          height={20}
          style={{
            color: unreadCount > 0 ? colors.text : colors.textMuted,
            transition: 'color 0.15s',
          }}
        />

        {unreadCount > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              background: '#0D9488',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 600,
              color: '#fff',
              fontFamily: fonts.sans,
            }}
          >
            {badgeLabel}
          </div>
        )}
      </button>
    </div>
  );
}
