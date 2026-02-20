import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body?: string;
  action_url?: string;
  read: boolean;
  created_at: string;
}

interface UseNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useNotifications(workspaceId: string): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch unread count
  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = (await api.get('/users/me/notifications/unread-count')) as { count: number };
      setUnreadCount(response.count);
    } catch (err) {
      console.error('Failed to fetch unread count:', err);
    }
  }, []);

  // Fetch recent notifications
  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = (await api.get(`/workspaces/${workspaceId}/notifications`)) as {
        notifications: Notification[];
      };
      setNotifications(response.notifications);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
      setError('Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  // Mark single notification as read
  const markRead = useCallback(async (notificationId: string) => {
    // Optimistic update
    setNotifications(prev =>
      prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
    );
    setUnreadCount(prev => Math.max(0, prev - 1));

    try {
      await api.post(`/workspaces/${workspaceId}/notifications/${notificationId}/read`, {});
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
      // Revert on error
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, read: false } : n)
      );
      setUnreadCount(prev => prev + 1);
    }
  }, [workspaceId]);

  // Mark all notifications as read
  const markAllRead = useCallback(async () => {
    const previousNotifications = [...notifications];
    const previousUnreadCount = unreadCount;

    // Optimistic update
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);

    try {
      await api.post(`/workspaces/${workspaceId}/notifications/read-all`, {});
    } catch (err) {
      console.error('Failed to mark all as read:', err);
      // Revert on error
      setNotifications(previousNotifications);
      setUnreadCount(previousUnreadCount);
    }
  }, [workspaceId, notifications, unreadCount]);

  // Manual refresh
  const refresh = useCallback(async () => {
    await Promise.all([fetchUnreadCount(), fetchNotifications()]);
  }, [fetchUnreadCount, fetchNotifications]);

  // Initial fetch on mount
  useEffect(() => {
    fetchUnreadCount();
    fetchNotifications();
  }, [fetchUnreadCount, fetchNotifications]);

  // Poll unread count every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchUnreadCount();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  return {
    notifications,
    unreadCount,
    loading,
    error,
    markRead,
    markAllRead,
    refresh,
  };
}
