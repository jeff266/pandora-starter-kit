/**
 * Notification Service
 *
 * Manages in-app notifications for workspace events
 */

import { query } from '../db.js';

export interface Notification {
  id: string;
  workspace_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
}

interface CreateParams {
  workspaceId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  actionUrl?: string;
}

export class NotificationService {
  /**
   * Create a notification for a specific user
   */
  async create(params: CreateParams): Promise<void> {
    const { workspaceId, userId, type, title, body, actionUrl } = params;

    try {
      await query<Record<string, never>>(`
        INSERT INTO notifications (
          workspace_id,
          user_id,
          type,
          title,
          body,
          action_url
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [workspaceId, userId, type, title, body || null, actionUrl || null]);

      console.log(`[notifications] Created ${type} notification for user ${userId} in workspace ${workspaceId}`);
    } catch (err) {
      console.error('[notifications] Error creating notification:', err instanceof Error ? err.message : err);
      // Don't throw - notification failure should not break primary operations
    }
  }

  /**
   * Create notifications for all Admin members in a workspace
   */
  async createForAdmins(
    workspaceId: string,
    params: Omit<CreateParams, 'workspaceId' | 'userId'>
  ): Promise<void> {
    try {
      // Get all active Admin members
      const adminsResult = await query<{ user_id: string }>(`
        SELECT wm.user_id
        FROM workspace_members wm
        JOIN workspace_roles wr ON wr.id = wm.role_id
        WHERE wm.workspace_id = $1
          AND wm.status = 'active'
          AND wr.system_type = 'admin'
      `, [workspaceId]);

      const admins = adminsResult.rows;

      if (admins.length === 0) {
        console.warn(`[notifications] No active admins found in workspace ${workspaceId}`);
        return;
      }

      // Create notification for each admin
      for (const admin of admins) {
        await this.create({
          workspaceId,
          userId: admin.user_id,
          ...params,
        });
      }

      console.log(`[notifications] Created ${params.type} notifications for ${admins.length} admins in workspace ${workspaceId}`);
    } catch (err) {
      console.error('[notifications] Error creating admin notifications:', err instanceof Error ? err.message : err);
      // Don't throw
    }
  }

  /**
   * Mark a single notification as read
   */
  async markRead(userId: string, notificationId: string): Promise<void> {
    try {
      await query<Record<string, never>>(`
        UPDATE notifications
        SET read_at = NOW()
        WHERE id = $1 AND user_id = $2 AND read_at IS NULL
      `, [notificationId, userId]);
    } catch (err) {
      console.error('[notifications] Error marking notification as read:', err instanceof Error ? err.message : err);
      throw err;
    }
  }

  /**
   * Mark all unread notifications as read for a user in a workspace
   */
  async markAllRead(userId: string, workspaceId: string): Promise<void> {
    try {
      await query<Record<string, never>>(`
        UPDATE notifications
        SET read_at = NOW()
        WHERE user_id = $1
          AND workspace_id = $2
          AND read_at IS NULL
      `, [userId, workspaceId]);
    } catch (err) {
      console.error('[notifications] Error marking all as read:', err instanceof Error ? err.message : err);
      throw err;
    }
  }

  /**
   * Get unread notifications for a user in a workspace
   */
  async getUnread(userId: string, workspaceId: string): Promise<Notification[]> {
    try {
      const result = await query<Notification>(`
        SELECT
          id,
          workspace_id,
          user_id,
          type,
          title,
          body,
          action_url,
          read_at,
          created_at
        FROM notifications
        WHERE user_id = $1
          AND workspace_id = $2
          AND read_at IS NULL
        ORDER BY created_at DESC
      `, [userId, workspaceId]);

      return result.rows;
    } catch (err) {
      console.error('[notifications] Error getting unread notifications:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  /**
   * Get recent notifications for a user in a workspace (read and unread)
   */
  async getRecent(userId: string, workspaceId: string, limit: number = 20): Promise<Notification[]> {
    try {
      const result = await query<Notification>(`
        SELECT
          id,
          workspace_id,
          user_id,
          type,
          title,
          body,
          action_url,
          read_at,
          created_at
        FROM notifications
        WHERE user_id = $1
          AND workspace_id = $2
        ORDER BY created_at DESC
        LIMIT $3
      `, [userId, workspaceId, limit]);

      return result.rows;
    } catch (err) {
      console.error('[notifications] Error getting recent notifications:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  /**
   * Get total unread count across all workspaces for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    try {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text as count
        FROM notifications
        WHERE user_id = $1 AND read_at IS NULL
      `, [userId]);

      return parseInt(result.rows[0]?.count || '0', 10);
    } catch (err) {
      console.error('[notifications] Error getting unread count:', err instanceof Error ? err.message : err);
      return 0;
    }
  }
}

// Singleton instance
export const notificationService = new NotificationService();
