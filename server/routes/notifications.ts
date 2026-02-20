/**
 * Notifications API
 *
 * Handles in-app notification retrieval and read status management.
 * Workspace routes mounted at /api/workspaces/:workspaceId
 * User routes mounted at /api/users/me
 */

import { Router, Request, Response } from 'express';
import { notificationService } from '../notifications/service.js';

// Workspace-scoped notification routes
export const workspaceNotificationsRouter = Router();

/**
 * GET /notifications
 * List recent notifications for current user in workspace
 */
workspaceNotificationsRouter.get('/notifications', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const limit = parseInt((req.query.limit as string) || '20', 10);
    const notifications = await notificationService.getRecent(userId, workspaceId, limit);

    res.json({ notifications });
  } catch (err) {
    console.error('[notifications] Error listing notifications:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to list notifications' });
  }
});

/**
 * POST /notifications/:notificationId/read
 * Mark a single notification as read
 */
workspaceNotificationsRouter.post('/notifications/:notificationId/read', async (req: Request, res: Response) => {
  try {
    const notificationId = req.params.notificationId as string;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    await notificationService.markRead(userId, notificationId);

    res.json({ success: true });
  } catch (err) {
    console.error('[notifications] Error marking notification as read:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

/**
 * POST /notifications/read-all
 * Mark all unread notifications as read for current user in workspace
 */
workspaceNotificationsRouter.post('/notifications/read-all', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    await notificationService.markAllRead(userId, workspaceId);

    res.json({ success: true });
  } catch (err) {
    console.error('[notifications] Error marking all as read:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// User-scoped notification routes
export const userNotificationsRouter = Router();

/**
 * GET /unread-count
 * Get total unread notification count across all workspaces for current user
 */
userNotificationsRouter.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const count = await notificationService.getUnreadCount(userId);

    res.json({ count });
  } catch (err) {
    console.error('[notifications] Error getting unread count:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});
