import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';

const router = Router();

router.get('/:id/icp/profiles', requirePermission('data.accounts_view'), async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.id;
  const { status } = req.query;

  try {
    const conditions: string[] = ['workspace_id = $1'];
    const params: unknown[] = [workspaceId];

    if (status) {
      if (status === 'active') {
        conditions.push("status = 'active'");
      } else if (status === 'archived') {
        conditions.push("status = 'superseded'");
      }
    }

    const result = await query(
      `SELECT
        id,
        version,
        status,
        personas,
        buying_committees,
        company_profile,
        scoring_weights,
        scoring_method,
        model_accuracy,
        model_metadata,
        deals_analyzed,
        won_deals,
        lost_deals,
        contacts_enriched,
        generated_at,
        generated_by,
        created_at
      FROM icp_profiles
      WHERE ${conditions.join(' AND ')}
      ORDER BY version DESC`,
      params
    );

    res.json({
      profiles: result.rows,
      total: result.rows.length,
    });
  } catch (err) {
    console.error('[icp] Error listing profiles:', err);
    res.status(500).json({ error: 'Failed to fetch ICP profiles' });
  }
});

router.get('/:id/icp/profiles/:profileId', requirePermission('data.accounts_view'), async (req: Request, res: Response): Promise<void> => {
  const { id: workspaceId, profileId } = req.params;

  try {
    const result = await query(
      `SELECT *
      FROM icp_profiles
      WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, profileId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'ICP profile not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[icp] Error fetching profile:', err);
    res.status(500).json({ error: 'Failed to fetch ICP profile' });
  }
});

// ============================================================================
// GET /:workspaceId/icp/readiness
// Returns data readiness for the ICP wizard Step 1
// ============================================================================

router.get('/:workspaceId/icp/readiness', requirePermission('data.accounts_view'), async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = req.params;

  try {
    // CRM: accounts and deals
    const crmResult = await query<{
      total_accounts: string;
      closed_won: string;
      closed_lost: string;
      total_deals: string;
      deals_with_account: string;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM accounts WHERE workspace_id = $1) AS total_accounts,
        COUNT(*) FILTER (WHERE stage_normalized = 'closed_won') AS closed_won,
        COUNT(*) FILTER (WHERE stage_normalized = 'closed_lost') AS closed_lost,
        COUNT(*) AS total_deals,
        COUNT(*) FILTER (WHERE account_id IS NOT NULL) AS deals_with_account
      FROM deals
      WHERE workspace_id = $1`,
      [workspaceId]
    );

    const crmRow = crmResult.rows[0];
    const totalAccounts = Number(crmRow?.total_accounts ?? 0);
    const closedWonDeals = Number(crmRow?.closed_won ?? 0);
    const closedLostDeals = Number(crmRow?.closed_lost ?? 0);
    const totalDeals = Number(crmRow?.total_deals ?? 0);
    const dealsWithAccount = Number(crmRow?.deals_with_account ?? 0);
    const dealLinkageRate = totalDeals > 0 ? dealsWithAccount / totalDeals : 0;

    // Conversations: total conversations, won-deal conversations, avg transcript length
    const convResult = await query<{
      total_conversations: string;
      won_deal_calls: string;
      avg_transcript_length: string | null;
    }>(
      `SELECT
        COUNT(*) AS total_conversations,
        COUNT(c.id) FILTER (
          WHERE d.stage_normalized = 'closed_won'
        ) AS won_deal_calls,
        AVG(LENGTH(c.transcript_text)) AS avg_transcript_length
      FROM conversations c
      LEFT JOIN deals d ON c.deal_id = d.id AND d.workspace_id = c.workspace_id
      WHERE c.workspace_id = $1`,
      [workspaceId]
    );

    const convRow = convResult.rows[0];
    const totalCalls = Number(convRow?.total_conversations ?? 0);
    const wonDealCalls = Number(convRow?.won_deal_calls ?? 0);

    // Determine conversation tier
    let tier: 0 | 1 | 2 | 3;
    let tierLabel: string;
    let callsNeededForNextTier: number | null;

    if (wonDealCalls === 0) {
      tier = 0;
      tierLabel = 'None';
      callsNeededForNextTier = 1;
    } else if (wonDealCalls < 10) {
      tier = 1;
      tierLabel = 'Insufficient';
      callsNeededForNextTier = 10 - wonDealCalls;
    } else if (wonDealCalls < 25) {
      tier = 2;
      tierLabel = 'Partial';
      callsNeededForNextTier = 25 - wonDealCalls;
    } else {
      tier = 3;
      tierLabel = 'Full';
      callsNeededForNextTier = null;
    }

    // Enrichment: account_signals
    const enrichResult = await query<{
      accounts_enriched: string;
      accounts_pending: string;
      avg_confidence: string | null;
      has_signal_score: string;
    }>(
      `SELECT
        COUNT(*) FILTER (WHERE classification_confidence IS NOT NULL) AS accounts_enriched,
        COUNT(*) FILTER (WHERE classification_confidence IS NULL) AS accounts_pending,
        AVG(classification_confidence) AS avg_confidence,
        COUNT(*) FILTER (WHERE signal_score IS NOT NULL) AS has_signal_score
      FROM account_signals
      WHERE workspace_id = $1`,
      [workspaceId]
    );

    const enrichRow = enrichResult.rows[0];
    const accountsEnriched = Number(enrichRow?.accounts_enriched ?? 0);
    const accountsPending = Number(enrichRow?.accounts_pending ?? 0);
    const avgConfidence = Number(enrichRow?.avg_confidence ?? 0);
    const totalSignalRows = accountsEnriched + accountsPending;

    // Check if a conversations connector (gong/fireflies) exists
    const connResult = await query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM connections
       WHERE workspace_id = $1 AND connector_name IN ('gong', 'fireflies')`,
      [workspaceId]
    );
    const hasConversationConnector = Number(connResult.rows[0]?.cnt ?? 0) > 0;

    // Build improvements list
    const improvements: string[] = [];

    if (closedLostDeals < 10) {
      improvements.push('Add more closed-lost deals to improve win/loss differentiation');
    }

    if (tier < 3) {
      const callsNeeded = tier === 0 ? 25 : tier === 1 ? (25 - wonDealCalls) : (25 - wonDealCalls);
      improvements.push(`${callsNeeded} more won-deal calls needed for full conversation tier`);
    }

    if (accountsPending > 0) {
      improvements.push(`Run account enrichment on ${accountsPending} accounts to improve signal quality`);
    }

    const canRun = closedWonDeals >= 30;

    res.json({
      crm: {
        connected: totalAccounts > 0 || totalDeals > 0,
        accounts: totalAccounts,
        closedWonDeals,
        closedLostDeals,
        dealLinkageRate,
        ready: canRun,
        minimumNeeded: 30,
      },
      conversations: {
        connected: hasConversationConnector || totalCalls > 0,
        totalCalls,
        wonDealCalls,
        tier,
        tierLabel,
        callsNeededForNextTier,
      },
      enrichment: {
        configured: totalSignalRows > 0,
        accountsEnriched,
        accountsPending,
        avgConfidence,
      },
      canRun,
      improvements,
    });
  } catch (err) {
    console.error('[icp] Error fetching readiness:', err);
    res.status(500).json({ error: 'Failed to fetch ICP readiness data' });
  }
});

// ============================================================================
// PATCH /:workspaceId/icp/profiles/:profileId
// Manual edit endpoint for ICP profile fields
// ============================================================================

const ALLOWED_EDIT_FIELDS = ['company_profile', 'conversation_insights', 'scoring_weights'];

router.patch('/:workspaceId/icp/profiles/:profileId', requirePermission('config.edit'), async (req: Request, res: Response): Promise<void> => {
  const { workspaceId, profileId } = req.params;
  const { field, value, note, changedBy } = req.body as {
    field: string;
    value: unknown;
    note: string;
    changedBy?: string;
  };

  if (!field || !ALLOWED_EDIT_FIELDS.includes(field)) {
    res.status(400).json({
      error: `Invalid field. Allowed fields: ${ALLOWED_EDIT_FIELDS.join(', ')}`,
    });
    return;
  }

  if (value === undefined) {
    res.status(400).json({ error: 'value is required' });
    return;
  }

  try {
    // Load current profile
    const currentResult = await query<Record<string, unknown>>(
      `SELECT * FROM icp_profiles WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, profileId]
    );

    if (currentResult.rows.length === 0) {
      res.status(404).json({ error: 'ICP profile not found' });
      return;
    }

    const currentProfile = currentResult.rows[0];
    const beforeValue = currentProfile[field];

    // Deep merge for JSONB fields if both old and new are objects
    let mergedValue: unknown = value;
    if (
      beforeValue !== null &&
      typeof beforeValue === 'object' &&
      !Array.isArray(beforeValue) &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      mergedValue = { ...(beforeValue as Record<string, unknown>), ...(value as Record<string, unknown>) };
    }

    // Apply the update
    const updateResult = await query<Record<string, unknown>>(
      `UPDATE icp_profiles
       SET ${field} = $1::jsonb
       WHERE workspace_id = $2 AND id = $3
       RETURNING *`,
      [JSON.stringify(mergedValue), workspaceId, profileId]
    );

    const updatedProfile = updateResult.rows[0];

    // Insert changelog entry
    await query(
      `INSERT INTO icp_changelog (
        workspace_id, profile_id, version, change_type,
        changed_by, change_note, diff
      ) VALUES ($1, $2, $3, 'manual_edit', $4, $5, $6::jsonb)`,
      [
        workspaceId,
        profileId,
        String(currentProfile.version ?? ''),
        changedBy ?? null,
        note ?? null,
        JSON.stringify({
          field,
          before: beforeValue,
          after: mergedValue,
        }),
      ]
    );

    res.json(updatedProfile);
  } catch (err) {
    console.error('[icp] Error patching profile:', err);
    res.status(500).json({ error: 'Failed to update ICP profile' });
  }
});

// ============================================================================
// GET /:workspaceId/icp/changelog
// Returns changelog entries for the workspace
// ============================================================================

router.get('/:workspaceId/icp/changelog', requirePermission('data.accounts_view'), async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = req.params;

  try {
    const result = await query(
      `SELECT
        cl.id,
        cl.workspace_id,
        cl.profile_id,
        cl.version,
        cl.change_type,
        cl.changed_by,
        cl.change_note,
        cl.diff,
        cl.accounts_affected,
        cl.created_at,
        p.version AS profile_version
      FROM icp_changelog cl
      LEFT JOIN icp_profiles p ON cl.profile_id = p.id
      WHERE cl.workspace_id = $1
      ORDER BY cl.created_at DESC`,
      [workspaceId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('[icp] Error fetching changelog:', err);
    res.status(500).json({ error: 'Failed to fetch ICP changelog' });
  }
});

// ============================================================================
// GET /:workspaceId/icp/taxonomy
// Returns the latest ICP taxonomy report for the Pro view
// ============================================================================

router.get('/:workspaceId/icp/taxonomy', requirePermission('data.accounts_view'), async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = req.params;

  try {
    const result = await query(
      `SELECT
        id,
        scope_id,
        vertical,
        taxonomy_report,
        account_classifications,
        accounts_analyzed,
        won_deals_count,
        serper_searches,
        generated_at
      FROM icp_taxonomy
      WHERE workspace_id = $1
      ORDER BY generated_at DESC
      LIMIT 1`,
      [workspaceId]
    );

    if (result.rows.length === 0) {
      res.json({ taxonomy: null });
      return;
    }

    res.json({ taxonomy: result.rows[0] });
  } catch (err) {
    console.error('[icp] Error fetching taxonomy:', err);
    res.status(500).json({ error: 'Failed to fetch ICP taxonomy' });
  }
});

// ============================================================================
// POST /:workspaceId/icp/export
// Export ICP profile via email (HTML and text versions)
// ============================================================================

router.post('/:workspaceId/icp/export', requirePermission('config.edit'), async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = req.params;
  const { to } = req.body as { to: string };

  if (!to) {
    res.status(400).json({ error: 'Email address (to) is required' });
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    res.status(500).json({ error: 'RESEND_API_KEY not configured' });
    return;
  }

  try {
    // Fetch active ICP profile
    const profileResult = await query<Record<string, unknown>>(
      `SELECT * FROM icp_profiles
       WHERE workspace_id = $1 AND status = 'active'
       ORDER BY version DESC LIMIT 1`,
      [workspaceId]
    );

    if (profileResult.rows.length === 0) {
      res.status(404).json({ error: 'No active ICP profile found' });
      return;
    }

    const profile = profileResult.rows[0] as unknown;

    // Generate Word document
    const { generateWordDocument } = await import('../email/icp-export-docx.js');
    const docxBuffer = await generateWordDocument(profile as never);

    // Generate email body (simple text version)
    const versionDate = new Date((profile as { created_at: string }).created_at).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    const emailBody = `Hi there,

Your ICP Profile export is ready! Please find the attached Word document with your complete ICP analysis.

This export includes:
• Ideal company profile with industry win rates
• Company size patterns and sweet spots
• Buying triggers from conversation analysis
• Winning buying committee patterns
• Disqualification criteria
• Recommended actions

Version: ${(profile as { version: number }).version}
Generated: ${versionDate}

This document contains proprietary RevOps intelligence. Please distribute internally only.

Best,
Pandora Intelligence Platform`;

    // Send email via Resend with attachment
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const emailPayload = {
      from: process.env.RESEND_FROM_EMAIL || 'Pandora <onboarding@resend.dev>',
      to,
      subject: `ICP Profile Export — v${(profile as { version: number }).version}`,
      text: emailBody,
      attachments: [
        {
          filename: `ICP_Profile_v${(profile as { version: number }).version}.docx`,
          content: docxBuffer,
        },
      ],
    };

    const result = await resend.emails.send(emailPayload as never);

    res.json({
      success: true,
      emailId: result.data?.id,
      recipient: to,
      format: 'docx',
    });
  } catch (err) {
    console.error('[icp] Error exporting profile:', err);
    res.status(500).json({ error: 'Failed to export ICP profile' });
  }
});

export default router;
