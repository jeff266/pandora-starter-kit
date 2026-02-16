/**
 * Channel Delivery System (Layer 7)
 *
 * Delivers agent outputs to various channels:
 * - Slack messages + file attachments
 * - Workspace downloads (persistent files)
 * - Command Center findings extraction
 * - Email (stub for future)
 */

import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { query } from '../db.js';
import type { AgentRunResult, SkillOutput } from './types.js';
import type { SkillEvidence } from '../skills/types.js';
import {
  renderDeliverable,
  renderMultiple,
  type RendererInput,
  type RenderOutput,
} from '../renderers/index.js';
import {
  postBlocks,
  postText,
  getSlackWebhook,
  formatHeader,
  formatSection,
  formatDivider,
  formatContext,
  type SlackBlock,
} from '../connectors/slack/client.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';
import { formatAgentWithEvidence } from '../skills/formatters/slack-formatter.js';

export type DeliveryChannel = 'slack' | 'download' | 'command_center' | 'email';

export interface DeliveryResult {
  channel: DeliveryChannel;
  status: 'success' | 'failed' | 'skipped';
  metadata?: {
    slack_message_ts?: string;
    slack_channel_id?: string;
    download_id?: string;
    download_url?: string;
    findings_count?: number;
    error?: string;
  };
}

export interface ChannelDeliveryOptions {
  channels: DeliveryChannel[];
  formats?: ('xlsx' | 'pdf' | 'slack_blocks' | 'command_center')[]; // For download channel
  slack_channel?: string; // Override default channel
  download_ttl_hours?: number; // File expiry time (null = permanent)
  extract_findings?: boolean; // Extract findings to findings table
}

/**
 * Deliver agent results to specified channels
 */
export async function deliverToChannels(
  agentRunResult: AgentRunResult,
  workspaceId: string,
  agentName: string,
  options: ChannelDeliveryOptions
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];

  // Assemble renderer input from agent results
  const rendererInput = await assembleRendererInput(
    agentRunResult,
    workspaceId
  );

  for (const channel of options.channels) {
    try {
      let result: DeliveryResult;

      switch (channel) {
        case 'slack':
          result = await deliverToSlack(
            agentRunResult,
            workspaceId,
            agentName,
            rendererInput,
            options.slack_channel
          );
          break;

        case 'download':
          result = await deliverToDownloads(
            agentRunResult,
            workspaceId,
            rendererInput,
            options.formats || ['xlsx'],
            options.download_ttl_hours
          );
          break;

        case 'command_center':
          result = await deliverToCommandCenter(
            agentRunResult,
            workspaceId,
            rendererInput
          );
          break;

        case 'email':
          result = {
            channel: 'email',
            status: 'skipped',
            metadata: { error: 'Email delivery not yet implemented' },
          };
          break;

        default:
          result = {
            channel,
            status: 'failed',
            metadata: { error: `Unknown channel: ${channel}` },
          };
      }

      results.push(result);
    } catch (err: any) {
      console.error(`[Channels] Failed to deliver to ${channel}:`, err.message);
      results.push({
        channel,
        status: 'failed',
        metadata: { error: err.message },
      });
    }
  }

  // Update agent_runs with delivery results
  await query(
    `UPDATE agent_runs
     SET deliveries = $1
     WHERE run_id = $2`,
    [JSON.stringify(results), agentRunResult.runId]
  );

  return results;
}

/**
 * Assemble RendererInput from agent run results
 */
async function assembleRendererInput(
  agentRunResult: AgentRunResult,
  workspaceId: string
): Promise<RendererInput> {
  // Fetch workspace details (including branding and voice config)
  const workspaceResult = await query(
    'SELECT id, name, branding, settings FROM workspaces WHERE id = $1',
    [workspaceId]
  );

  if (workspaceResult.rows.length === 0) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  const workspace = workspaceResult.rows[0];
  const voiceConfig = workspace.settings?.voice;

  // Build AgentOutput structure
  const skillEvidence: SkillEvidence[] = agentRunResult.skillEvidence
    ? Object.values(agentRunResult.skillEvidence)
    : [];

  return {
    agentOutput: {
      agent_run_id: agentRunResult.runId,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        branding: workspace.branding,
        voice: voiceConfig,
      },
      skill_evidence: skillEvidence,
      narrative: agentRunResult.synthesizedOutput || undefined,
      findings: extractFindingsFromEvidence(skillEvidence),
      metadata: {
        total_skills: agentRunResult.skillResults.length,
        skills_executed: agentRunResult.skillResults.filter(
          (r) => r.status === 'completed'
        ).length,
        skills_cached: agentRunResult.skillResults.filter(
          (r) => r.status === 'cached'
        ).length,
        skills_failed: agentRunResult.skillResults.filter(
          (r) => r.status === 'failed'
        ).length,
        total_tokens_used: agentRunResult.tokenUsage.total,
        execution_duration_ms: agentRunResult.duration,
      },
    },
    workspace: {
      id: workspace.id,
      name: workspace.name,
      branding: workspace.branding,
      voice: voiceConfig,
    },
    options: {},
  };
}

/**
 * Deliver to Slack channel with Block Kit formatting
 */
async function deliverToSlack(
  agentRunResult: AgentRunResult,
  workspaceId: string,
  agentName: string,
  rendererInput: RendererInput,
  slackChannel?: string
): Promise<DeliveryResult> {
  // Render to Slack blocks
  const renderOutput = await renderDeliverable('slack_blocks', rendererInput);

  if (!renderOutput.slack_blocks) {
    return {
      channel: 'slack',
      status: 'failed',
      metadata: { error: 'Renderer did not produce slack_blocks' },
    };
  }

  const blocks = renderOutput.slack_blocks;

  // Try Slack app client first (preferred)
  const slackAppClient = getSlackAppClient();
  const botToken = await slackAppClient.getBotToken(workspaceId);

  if (botToken) {
    const channel =
      slackChannel || (await slackAppClient.getDefaultChannel(workspaceId));
    if (channel) {
      const response = await slackAppClient.postMessage(
        workspaceId,
        channel,
        blocks
      );
      if (response.ts && response.channel) {
        query(
          `INSERT INTO thread_anchors (workspace_id, channel_id, message_ts, agent_run_id, report_type)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (channel_id, message_ts) DO NOTHING`,
          [workspaceId, response.channel, response.ts, agentRunResult.runId, agentName]
        ).catch(err => console.error('[channels] Failed to store thread_anchor:', err));
      }
      return {
        channel: 'slack',
        status: 'success',
        metadata: {
          slack_message_ts: response.ts,
          slack_channel_id: response.channel,
        },
      };
    }
  }

  // Fallback to webhook
  const webhookUrl = await getSlackWebhook(workspaceId);
  if (!webhookUrl) {
    return {
      channel: 'slack',
      status: 'failed',
      metadata: {
        error: 'No Slack webhook or bot token configured for workspace',
      },
    };
  }

  await postBlocks(webhookUrl, blocks);

  return {
    channel: 'slack',
    status: 'success',
    metadata: {},
  };
}

/**
 * Deliver to workspace downloads (persistent files)
 */
async function deliverToDownloads(
  agentRunResult: AgentRunResult,
  workspaceId: string,
  rendererInput: RendererInput,
  formats: ('xlsx' | 'pdf' | 'pptx')[],
  ttlHours?: number
): Promise<DeliveryResult> {
  const downloadIds: string[] = [];
  const downloadUrls: string[] = [];

  // Ensure workspace downloads directory exists
  const downloadsDir = path.join(
    process.cwd(),
    'workspace_storage',
    workspaceId,
    'downloads'
  );
  await fs.mkdir(downloadsDir, { recursive: true });

  // Render in all requested formats
  const renderOutputs = await renderMultiple(formats, rendererInput);

  for (const renderOutput of renderOutputs) {
    if (!renderOutput.buffer && !renderOutput.filepath) {
      console.warn(
        `[Channels] Renderer for ${renderOutput.format} did not produce buffer or filepath`
      );
      continue;
    }

    // Generate filename
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename =
      renderOutput.filename ||
      `agent-${agentRunResult.agentId}-${timestamp}.${renderOutput.format}`;
    const filePath = path.join(downloadsDir, filename);

    // Write file
    if (renderOutput.buffer) {
      await fs.writeFile(filePath, renderOutput.buffer);
    } else if (renderOutput.filepath) {
      // Renderer already wrote to temp location, move it
      await fs.rename(renderOutput.filepath, filePath);
    }

    const stats = await fs.stat(filePath);
    const relativePath = path.relative(
      path.join(process.cwd(), 'workspace_storage'),
      filePath
    );

    // Calculate expiry
    const expiresAt = ttlHours
      ? new Date(Date.now() + ttlHours * 60 * 60 * 1000)
      : null;

    // Insert into workspace_downloads
    const result = await query(
      `INSERT INTO workspace_downloads (
        workspace_id, agent_run_id, filename, format, file_path,
        file_size_bytes, created_by, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id`,
      [
        workspaceId,
        agentRunResult.runId,
        filename,
        renderOutput.format,
        relativePath,
        stats.size,
        'system',
        expiresAt,
      ]
    );

    const downloadId = result.rows[0].id;
    downloadIds.push(downloadId);
    downloadUrls.push(`/api/downloads/${downloadId}`);
  }

  return {
    channel: 'download',
    status: 'success',
    metadata: {
      download_id: downloadIds.join(','),
      download_url: downloadUrls[0], // Primary download URL
    },
  };
}

/**
 * Deliver to Command Center (extract findings)
 */
async function deliverToCommandCenter(
  agentRunResult: AgentRunResult,
  workspaceId: string,
  rendererInput: RendererInput
): Promise<DeliveryResult> {
  if (!rendererInput.agentOutput) {
    return {
      channel: 'command_center',
      status: 'skipped',
      metadata: { error: 'No agent output to extract findings from' },
    };
  }

  const findings = rendererInput.agentOutput.findings;

  if (!findings || findings.length === 0) {
    return {
      channel: 'command_center',
      status: 'success',
      metadata: { findings_count: 0 },
    };
  }

  // Auto-resolve old findings from the same skills
  const skillIds = findings.map((f) => f.skill_id);
  if (skillIds.length > 0) {
    await query(
      `UPDATE findings
       SET resolved_at = NOW()
       WHERE workspace_id = $1
         AND skill_id = ANY($2)
         AND resolved_at IS NULL`,
      [workspaceId, skillIds]
    );
  }

  // Insert new findings
  for (const finding of findings) {
    // Map skill evidence severity to findings table severity
    // Skill evidence: 'critical' | 'warning' | 'info'
    // Findings table: 'act' | 'watch' | 'notable' | 'info'
    const mappedSeverity = mapSeverity(finding.severity);

    await query(
      `INSERT INTO findings (
        workspace_id, agent_run_id, skill_run_id, skill_id, severity, category,
        message, entity_type, entity_id, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        workspaceId,
        agentRunResult.runId,
        null, // skill_run_id is null for agent-extracted findings
        finding.skill_id,
        mappedSeverity,
        finding.category || null,
        finding.claim,
        finding.entity_type || null,
        finding.entity_id || null,
        JSON.stringify(finding.supporting_data || {}),
      ]
    );
  }

  console.log(
    `[Channels] Extracted ${findings.length} findings to Command Center`
  );

  return {
    channel: 'command_center',
    status: 'success',
    metadata: { findings_count: findings.length },
  };
}

/**
 * Extract findings from skill evidence (claims array)
 */
function extractFindingsFromEvidence(
  skillEvidence: SkillEvidence[]
): Array<{
  skill_id: string;
  claim: string;
  severity: 'critical' | 'warning' | 'info';
  category?: string;
  entity_type?: string;
  entity_id?: string;
  entity_label?: string;
  supporting_data?: any;
}> {
  const findings: any[] = [];

  for (const evidence of skillEvidence) {
    if (!evidence.claims || evidence.claims.length === 0) continue;

    for (const claim of evidence.claims) {
      findings.push({
        skill_id: evidence.skill_id,
        claim: claim.claim,
        severity: claim.severity,
        category: claim.category,
        entity_type: claim.entity_type,
        entity_id: claim.entity_id,
        entity_label: claim.entity_label,
        supporting_data: claim.supporting_data,
      });
    }
  }

  return findings;
}

/**
 * Map skill evidence severity to findings table severity
 * Skill evidence uses: 'critical' | 'warning' | 'info'
 * Findings table uses: 'act' | 'watch' | 'notable' | 'info'
 */
function mapSeverity(severity: 'critical' | 'warning' | 'info'): 'act' | 'watch' | 'notable' | 'info' {
  switch (severity) {
    case 'critical':
      return 'act';
    case 'warning':
      return 'watch';
    case 'info':
      return 'info';
    default:
      return 'info'; // Fallback
  }
}
