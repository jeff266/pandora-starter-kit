/**
 * Report Document Writer
 *
 * Converts agent run synthesis output to report_documents format
 * so all agent runs appear in the Reports timeline with full
 * PDF/DOCX export, charts, annotations, and other features.
 */

import { query } from '../db.js';
import { randomUUID } from 'crypto';

export interface AgentRunReportInput {
  workspaceId: string;
  agentId: string;
  agentName: string;
  agentDescription?: string;
  agentGoal?: string;
  synthesizedOutput: string;
  runId: string;
  skillsRun: string[];
  generatedAt: Date;
}

export async function writeAgentRunToReportDocuments(
  input: AgentRunReportInput
): Promise<string> {
  const {
    workspaceId,
    agentId,
    agentName,
    agentDescription,
    agentGoal,
    synthesizedOutput,
    runId,
    skillsRun,
    generatedAt,
  } = input;

  // Build week_label from run timestamp
  // Format: "Run of March 19, 2026"
  const weekLabel = `Run of ${generatedAt.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })}`;

  // Extract headline from synthesized output
  // First sentence, max 120 chars
  const headline = extractHeadline(synthesizedOutput);

  // Convert synthesized output to sections array
  // Agent runs produce free-form text, not MECE sections.
  // Wrap in a single section or parse if the output has clear structure.
  const sections = buildSectionsFromOutput(
    synthesizedOutput,
    agentGoal,
    skillsRun
  );

  const result = await query(
    `INSERT INTO report_documents (
      workspace_id,
      agent_id,
      agent_run_id,
      document_type,
      week_label,
      headline,
      sections,
      actions,
      skills_included,
      skills_omitted,
      orchestrator_run_id,
      generated_at,
      config
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id`,
    [
      workspaceId,
      agentId,
      runId,
      'agent_run', // NEW document_type
      weekLabel,
      headline,
      JSON.stringify(sections),
      JSON.stringify([]), // No structured actions in agent runs (yet)
      skillsRun,
      [], // skills_omitted - empty for agent runs
      randomUUID(), // orchestrator_run_id placeholder (agent runs don't use orchestrator)
      generatedAt,
      JSON.stringify({
        agent_name: agentName,
        agent_description: agentDescription,
        agent_goal: agentGoal,
        run_id: runId,
        skills_run: skillsRun,
      }),
    ]
  );

  const reportDocumentId = result.rows[0].id;

  console.log(
    `[AgentRuntime] Wrote agent run to report_documents: ${reportDocumentId} ` +
      `(agent: ${agentName}, type: agent_run)`
  );

  return reportDocumentId;
}

/**
 * Extract first sentence as headline.
 * Max 120 chars.
 */
function extractHeadline(output: string): string {
  const first = output
    .replace(/^#+\s*/m, '') // strip markdown headers
    .split(/[.!?]/)[0]
    .trim();
  return first.length > 120 ? first.slice(0, 117) + '...' : first;
}

/**
 * Convert free-form agent output to sections array.
 *
 * Strategy:
 * 1. If output has markdown headers (## or ###),
 *    split on headers to create multiple sections
 * 2. Otherwise, create a single section with
 *    the full output as content
 */
function buildSectionsFromOutput(
  output: string,
  agentGoal?: string,
  skillsRun?: string[]
): any[] {
  // Try to split on markdown headers
  const headerRegex = /^#{1,3}\s+(.+)$/gm;
  const headers: { title: string; pos: number }[] = [];
  let match;

  while ((match = headerRegex.exec(output)) !== null) {
    headers.push({
      title: match[1].trim(),
      pos: match.index,
    });
  }

  if (headers.length >= 2) {
    // Split into sections by headers
    return headers.map((header, i) => {
      const start = header.pos;
      const end = i < headers.length - 1 ? headers[i + 1].pos : output.length;

      // Extract content after the header line
      const headerLineEnd = output.indexOf('\n', start);
      const contentStart = headerLineEnd !== -1 ? headerLineEnd + 1 : start;
      const content = output.slice(contentStart, end).trim();

      return {
        id: `section-${i + 1}`,
        title: header.title,
        content,
        standing_question: header.title,
        source_skills: skillsRun || [],
        position: i + 1,
      };
    });
  }

  // Single section fallback
  return [
    {
      id: 'section-1',
      title: agentGoal || 'Analysis',
      content: output,
      standing_question: agentGoal || '',
      source_skills: skillsRun || [],
      position: 1,
    },
  ];
}
