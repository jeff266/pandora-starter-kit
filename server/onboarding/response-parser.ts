import { callLLM } from '../utils/llm-router.js';
import type { OnboardingQuestion, Hypothesis, ConfigPatch } from './types.js';

const SCHEMA_GUIDANCE: Record<string, string> = {
  Q1_motions: `Return: { "motions": [{ "name": string, "filter_field": "pipeline"|"deal_type"|"record_type"|"amount", "filter_values": string[], "amount_threshold"?: number, "deal_count"?: number, "avg_size"?: number }] }`,
  Q2_calendar: `Return: { "fiscal_year_start_month": 1-12, "quota_period": "monthly"|"quarterly", "quarterly_target"?: number, "motion_targets"?: [{ "motion": string, "target": number }] }`,
  Q3_stages: `Return: { "won_stages": string[], "lost_stages": string[], "parking_lot_stages": string[], "stage_0_stages": string[], "retired_stages": string[] }`,
  Q4_team: `Return: { "reps": [{ "name": string, "motion"?: string, "is_new_hire"?: boolean }], "excluded_owners": string[], "managers": string[] }`,
  Q5_stale: `Return: { "thresholds": [{ "motion": string, "stale_days": number, "critical_days": number }] | { "stale_days": number, "critical_days": number } }`,
  Q6_forecast: `Return: { "forecast_method": "stage_probability"|"rep_categories"|"hybrid", "category_field"?: string, "commit_confidence"?: number }`,
  Q7_winrate: `Return: { "exclude_stage_0": boolean, "lookback_days": 90|180|365, "segment_by_motion": boolean }`,
  Q8_coverage: `Return: { "coverage_target": number, "motion_targets"?: [{ "motion": string, "target": number }] }`,
  Q9_fields: `Return: { "required_fields": string[], "ignored_fields": string[], "stage_requirements"?: [{ "stage": string, "fields": string[] }] }`,
  Q10_delivery: `Return: { "timezone": string, "slack_channel"?: string, "brief_time"?: string, "additional_recipients"?: string[] }`,
};

export async function parseResponse(
  workspaceId: string,
  question: OnboardingQuestion,
  hypothesis: Hypothesis,
  userResponse: string,
  workspaceContext = '',
): Promise<ConfigPatch> {
  const schema = SCHEMA_GUIDANCE[question.id] || `Return: a JSON object with values for these config targets: ${question.config_targets.join(', ')}`;

  const hypothesisSummary = hypothesis.summary
    ? `Hypothesis shown to user: "${hypothesis.summary}"`
    : '';

  const prompt = `You are a RevOps configuration assistant for a sales intelligence platform.

The user was asked: "${question.title}" — ${question.prompt_intro}

${hypothesisSummary}

User's response: "${userResponse}"

${workspaceContext ? `Workspace context: ${workspaceContext}` : ''}

Extract the user's intent as structured configuration. Be liberal in interpreting natural language.

${schema}

Additional rules:
- If the user says "that looks right" or "yes" or "correct", accept the hypothesis suggested_value unchanged
- If the user corrects specific items, update only those items
- If the response is unclear, set _parser_confidence below 0.5 and explain in _interpretation_notes
- Always include "_parser_confidence" (0-1) and "_interpretation_notes" fields
- Return only valid JSON, no markdown fences`;

  try {
    const response = await callLLM(workspaceId, 'extract', {
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 600,
    });
    const text = response.content.trim().replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/```$/, '');
    const parsed = JSON.parse(text) as ConfigPatch;
    return parsed;
  } catch (err) {
    return {
      parse_error: true,
      raw: userResponse,
      _parser_confidence: 0,
      _interpretation_notes: `Failed to parse response: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function parseUploadedDocument(
  workspaceId: string,
  question: OnboardingQuestion,
  fileText: string,
  fileType: string,
  workspaceContext = '',
): Promise<Hypothesis> {
  const schema = SCHEMA_GUIDANCE[question.id] || `configuration values for: ${question.config_targets.join(', ')}`;

  const prompt = `You are analyzing a document uploaded during a sales workspace setup interview.

The document type is: ${fileType}
It was uploaded in response to the question: "${question.title}" — ${question.prompt_intro}

Document content:
${fileText.slice(0, 6000)}

${workspaceContext ? `Workspace context: ${workspaceContext}` : ''}

Extract the relevant configuration data for: ${question.config_targets.join(', ')}

Return a JSON object with:
{
  "summary": "One sentence describing what you found",
  "table": [{ ... }],  // optional: array of row objects if tabular data was found
  "columns": ["col1", "col2"],  // optional: column headers for the table
  "confidence": 0-1,
  "evidence": "What in the document informed this",
  "suggested_value": { ${schema} }
}

Be specific about what you found. If the document doesn't contain relevant information, set confidence to 0 and explain.
Return only valid JSON, no markdown.`;

  try {
    const response = await callLLM(workspaceId, 'extract', {
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 800,
    });
    const text = response.content.trim().replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/```$/, '');
    const parsed = JSON.parse(text) as Hypothesis;
    return {
      summary: parsed.summary || 'Extracted from document',
      table: parsed.table,
      columns: parsed.columns,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      evidence: parsed.evidence || `Extracted from ${fileType}`,
      suggested_value: parsed.suggested_value,
    };
  } catch {
    return {
      summary: 'Could not extract structured data from this document.',
      confidence: 0,
      evidence: 'Parse failed',
      suggested_value: null,
    };
  }
}
