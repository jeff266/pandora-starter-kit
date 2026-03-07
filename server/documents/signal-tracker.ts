import pool, { query } from '../db.js';
import { configLoader } from '../config/workspace-config-loader.js';
import { WorkspaceDocumentProfile } from '../types/document-profile.js';

/**
 * Capture engagement from Slack for a distributed document
 * Schedules a 24h delayed check to fetch reactions and replies
 */
export async function captureSlackEngagement(
  workspaceId: string,
  documentId: string,
  templateType: string,
  slackMessageTs: string,
  slackChannel: string
): Promise<void> {
  // In a real production system, this would be a background job (BullMQ, etc.)
  // For this implementation, we'll use a delayed promise to simulate the 24h check
  // NOTE: This will not survive server restarts. In production, use a persistent task queue.
  
  const DELAY_24H = 24 * 60 * 60 * 1000;
  
  setTimeout(async () => {
    try {
      console.log(`[SignalTracker] Running 24h Slack engagement check for doc ${documentId}`);
      
      // 1. Fetch reactions/replies from Slack
      // This would call the Slack API using the workspace's tokens
      // For now, we simulate this with a mock call or a placeholder
      const engagement = await fetchSlackEngagement(workspaceId, slackChannel, slackMessageTs);
      
      // 2. Update document_distributions metadata
      await query(
        `UPDATE document_distributions 
         SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{slack_engagement}', $1::jsonb, true)
         WHERE workspace_id = $2 AND document_id = $3 AND channel = 'slack'`,
        [JSON.stringify(engagement), workspaceId, documentId]
      );
      
      // 3. Update engagement averages in profile
      await updateEngagementAverages(workspaceId, templateType, engagement.reactions, engagement.replies);
      
      // 4. Recalculate quality score
      await recalculateQualityScore(workspaceId);
      
    } catch (err) {
      console.error(`[SignalTracker] Error in captureSlackEngagement for doc ${documentId}:`, err);
    }
  }, DELAY_24H);
}

/**
 * Check if a document was distributed within 48h
 */
export async function checkDistributionDeadline(
  workspaceId: string,
  documentId: string,
  templateType: string
): Promise<void> {
  const DELAY_48H = 48 * 60 * 60 * 1000;
  
  setTimeout(async () => {
    try {
      const result = await query(
        `SELECT id FROM document_distributions WHERE document_id = $1 AND status = 'sent'`,
        [documentId]
      );
      
      if (result.rows.length === 0) {
        // No distribution records found after 48h
        await writeTrainingSignal(workspaceId, documentId, templateType, 'rendered_not_distributed');
        await recalculateQualityScore(workspaceId);
      }
    } catch (err) {
      console.error(`[SignalTracker] Error in checkDistributionDeadline for doc ${documentId}:`, err);
    }
  }, DELAY_48H);
}

/**
 * Write a weak training signal to the document profile
 */
export async function writeTrainingSignal(
  workspaceId: string,
  documentId: string,
  templateType: string,
  signal: string
): Promise<void> {
  const profile = await configLoader.getDocumentProfile(workspaceId);
  
  // Weak signal storage in workspace memory or document profile metadata
  // We'll store it in a generic 'signals' array in distributionPatterns for now
  const distributionPatterns = profile.distributionPatterns as any;
  if (!distributionPatterns.signals) {
    distributionPatterns.signals = [];
  }
  
  distributionPatterns.signals.push({
    documentId,
    templateType,
    signal,
    timestamp: new Date().toISOString()
  });
  
  // Keep only last 50 signals
  if (distributionPatterns.signals.length > 50) {
    distributionPatterns.signals.shift();
  }
  
  await configLoader.updateDocumentProfile(workspaceId, {
    distributionPatterns
  });
}

/**
 * Update engagement averages in document profile
 */
async function updateEngagementAverages(
  workspaceId: string,
  templateType: string,
  reactions: number,
  replies: number
): Promise<void> {
  const profile = await configLoader.getDocumentProfile(workspaceId);
  const slackEngagementByTemplate = { ...profile.distributionPatterns.slackEngagementByTemplate };
  
  const current = slackEngagementByTemplate[templateType] || { reactions: 0, replies: 0 };
  
  // Moving average (0.7 current, 0.3 new)
  slackEngagementByTemplate[templateType] = {
    reactions: Math.round(current.reactions * 0.7 + reactions * 0.3),
    replies: Math.round(current.replies * 0.7 + replies * 0.3)
  };
  
  await configLoader.updateDocumentProfile(workspaceId, {
    distributionPatterns: {
      ...profile.distributionPatterns,
      slackEngagementByTemplate
    }
  });
}

/**
 * Recalculate the overall quality score for the workspace
 */
export async function recalculateQualityScore(workspaceId: string): Promise<void> {
  const profile = await configLoader.getDocumentProfile(workspaceId);
  
  // 1. Fetch recent training pairs
  const pairsResult = await query(
    `SELECT edit_distance, recommendations_actioned, was_distributed
     FROM document_training_pairs
     WHERE workspace_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [workspaceId]
  );
  
  if (pairsResult.rows.length === 0) return;
  
  const rows = pairsResult.rows;
  
  // 2. Compute metrics
  // editScore: 1 - average normalized edit distance (inverse of edits)
  const avgEditDist = rows.reduce((sum, r) => sum + Number(r.edit_distance), 0) / rows.length;
  const editScore = Math.max(0, 1 - avgEditDist);
  
  // actionScore: pct of recommendations actioned
  const actionCount = rows.filter(r => r.recommendations_actioned).length;
  const actionScore = actionCount / rows.length;
  
  // distScore: pct distributed
  const distCount = rows.filter(r => r.was_distributed).length;
  const distScore = distCount / rows.length;
  
  // 3. Weighted overall score
  const overall = Math.round((editScore * 0.5 + actionScore * 0.3 + distScore * 0.2) * 100);
  
  const oldScore = profile.qualityScores.overall;
  const trend = overall > oldScore ? 'up' : (overall < oldScore ? 'down' : 'stable');
  
  await configLoader.updateDocumentProfile(workspaceId, {
    qualityScores: {
      overall,
      trend,
      lastUpdated: new Date().toISOString()
    }
  });
}

/**
 * Mock Slack engagement fetcher
 */
async function fetchSlackEngagement(
  workspaceId: string, 
  channel: string, 
  ts: string
): Promise<{ reactions: number; replies: number }> {
  // In a real implementation, this would use the Slack API:
  // const slack = await getSlackClient(workspaceId);
  // const result = await slack.conversations.replies({ channel, ts });
  // count reactions and replies...
  
  // For now, return random mock data for demonstration
  return {
    reactions: Math.floor(Math.random() * 5),
    replies: Math.floor(Math.random() * 3)
  };
}
