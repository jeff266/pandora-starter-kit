import { query } from '../db.js';

export interface RateLimitConfig {
  max_refreshes_per_hour: number;
  cooldown_minutes: number;
  byok_unlimited: boolean;
}

const PLAN_RATE_LIMITS: Record<string, RateLimitConfig> = {
  design_partner: {
    max_refreshes_per_hour: 1,
    cooldown_minutes: 60,
    byok_unlimited: false,
  },
  starter: {
    max_refreshes_per_hour: 1,
    cooldown_minutes: 60,
    byok_unlimited: false,
  },
  growth: {
    max_refreshes_per_hour: 4,
    cooldown_minutes: 15,
    byok_unlimited: false,
  },
  consultant: {
    max_refreshes_per_hour: 8,
    cooldown_minutes: 10,
    byok_unlimited: false,
  },
};

const DEFAULT_LIMIT: RateLimitConfig = {
  max_refreshes_per_hour: 1,
  cooldown_minutes: 60,
  byok_unlimited: false,
};

export async function checkRefreshRateLimit(workspaceId: string): Promise<{
  allowed: boolean;
  reason?: string;
  next_allowed_at?: string;
  is_byok: boolean;
}> {
  const llmConfigResult = await query<{ providers: any }>(
    `SELECT providers FROM llm_configs WHERE workspace_id = $1`,
    [workspaceId]
  );

  const hasByok = hasValidByokKey(llmConfigResult.rows[0]?.providers);

  if (hasByok) {
    return { allowed: true, is_byok: true };
  }

  const workspaceResult = await query<{ plan_type: string | null }>(
    `SELECT COALESCE(plan_type, 'design_partner') as plan_type FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  const planType = workspaceResult.rows[0]?.plan_type || 'design_partner';
  const planLimit = PLAN_RATE_LIMITS[planType] || DEFAULT_LIMIT;

  const recentRefreshes = await query<{ created_at: string; synthesis_ran: boolean }>(
    `SELECT created_at, synthesis_ran
     FROM brief_refresh_log
     WHERE workspace_id = $1
       AND synthesis_ran = true
       AND created_at >= NOW() - INTERVAL '1 hour'
     ORDER BY created_at DESC`,
    [workspaceId]
  );

  const refreshRows = recentRefreshes.rows;

  if (refreshRows.length >= planLimit.max_refreshes_per_hour) {
    const oldestInWindow = refreshRows[refreshRows.length - 1];
    const nextAllowedAt = new Date(
      new Date(oldestInWindow.created_at).getTime() + 60 * 60 * 1000
    );
    return {
      allowed: false,
      is_byok: false,
      reason: `Brief refreshed ${refreshRows.length} time(s) this hour. Add your own API key to unlock unlimited refreshes.`,
      next_allowed_at: nextAllowedAt.toISOString(),
    };
  }

  if (refreshRows.length > 0) {
    const lastRefresh = refreshRows[0];
    const minutesSinceLastRefresh =
      (Date.now() - new Date(lastRefresh.created_at).getTime()) / 60000;

    if (minutesSinceLastRefresh < planLimit.cooldown_minutes) {
      const nextAllowedAt = new Date(
        new Date(lastRefresh.created_at).getTime() + planLimit.cooldown_minutes * 60 * 1000
      );
      return {
        allowed: false,
        is_byok: false,
        reason: `Brief was refreshed ${Math.round(minutesSinceLastRefresh)} minutes ago. Next refresh available in ${Math.round(planLimit.cooldown_minutes - minutesSinceLastRefresh)} minutes.`,
        next_allowed_at: nextAllowedAt.toISOString(),
      };
    }
  }

  return { allowed: true, is_byok: false };
}

function hasValidByokKey(providers: any): boolean {
  if (!providers) return false;
  return Object.values(providers).some(
    (p: any) => p?.api_key && typeof p.api_key === 'string' && p.api_key.length > 10
  );
}
