import { query } from '../db.js';
import { ReportDocument, ChartSuggestion } from './types.js';

async function getChartSuggestionsForReport(
  reportDocumentId: string
): Promise<ChartSuggestion[]> {
  const result = await query(`
    SELECT section_id, chart_type, title, data_labels, data_values, reasoning, priority
    FROM report_chart_suggestions
    WHERE report_document_id = $1
    ORDER BY priority DESC, created_at ASC
  `, [reportDocumentId]);

  return result.rows.map(row => ({
    section_id: row.section_id,
    chart_type: row.chart_type,
    title: row.title,
    data_labels: row.data_labels,
    data_values: row.data_values,
    reasoning: row.reasoning,
    priority: row.priority,
  }));
}

export async function persistReportDocument(
  doc: ReportDocument
): Promise<string> {
  const result = await query(`
    INSERT INTO report_documents (
      workspace_id, agent_run_id, document_type, week_label,
      headline, sections, actions, recommended_next_steps,
      skills_included, skills_omitted, total_word_count,
      tokens_used, orchestrator_run_id, generated_at,
      hypothesis_updates
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING id
  `, [
    doc.workspace_id,
    doc.agent_run_id,
    doc.document_type,
    doc.week_label,
    doc.headline,
    JSON.stringify(doc.sections),
    JSON.stringify(doc.actions),
    doc.recommended_next_steps,
    doc.skills_included,
    doc.skills_omitted,
    doc.total_word_count,
    doc.tokens_used,
    doc.orchestrator_run_id,
    doc.generated_at,
    JSON.stringify(doc.hypothesis_updates || []),
  ]);

  const reportDocumentId = result.rows[0].id;

  // Persist chart suggestions
  if (doc.chart_suggestions && doc.chart_suggestions.length > 0) {
    for (const suggestion of doc.chart_suggestions) {
      await query(`
        INSERT INTO report_chart_suggestions (
          workspace_id, report_document_id, section_id, chart_type,
          title, data_labels, data_values, reasoning, priority
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        doc.workspace_id,
        reportDocumentId,
        suggestion.section_id,
        suggestion.chart_type,
        suggestion.title,
        JSON.stringify(suggestion.data_labels),
        JSON.stringify(suggestion.data_values),
        suggestion.reasoning,
        suggestion.priority,
      ]);
    }
  }

  return reportDocumentId;
}

export async function getLatestReportDocument(
  workspaceId: string,
  documentType: string
): Promise<ReportDocument | null> {
  const result = await query(`
    SELECT * FROM report_documents
    WHERE workspace_id = $1
      AND document_type = $2
    ORDER BY generated_at DESC
    LIMIT 1
  `, [workspaceId, documentType]);

  if (!result.rows[0]) return null;

  const row = result.rows[0];
  const chartSuggestions = await getChartSuggestionsForReport(row.id);

  return {
    id: row.id,
    document_type: row.document_type,
    workspace_id: row.workspace_id,
    agent_run_id: row.agent_run_id,
    generated_at: row.generated_at,
    week_label: row.week_label,
    headline: row.headline,
    sections: row.sections,
    actions: row.actions,
    recommended_next_steps: row.recommended_next_steps,
    chart_suggestions: chartSuggestions,
    hypothesis_updates: row.hypothesis_updates || [],
    skills_included: row.skills_included,
    skills_omitted: row.skills_omitted,
    total_word_count: row.total_word_count,
    tokens_used: row.tokens_used,
    orchestrator_run_id: row.orchestrator_run_id,
  };
}

export async function getPriorReportHeadline(
  workspaceId: string,
  documentType: string
): Promise<string | undefined> {
  const result = await query(`
    SELECT headline FROM report_documents
    WHERE workspace_id = $1
      AND document_type = $2
    ORDER BY generated_at DESC
    LIMIT 1 OFFSET 1
  `, [workspaceId, documentType]);

  return result.rows[0]?.headline;
}

export async function getAllReportsForWorkspace(
  workspaceId: string,
  limit: number = 10
): Promise<ReportDocument[]> {
  const result = await query(`
    SELECT * FROM report_documents
    WHERE workspace_id = $1
    ORDER BY generated_at DESC
    LIMIT $2
  `, [workspaceId, limit]);

  return Promise.all(result.rows.map(async row => {
    const chartSuggestions = await getChartSuggestionsForReport(row.id);
    return {
      id: row.id,
      document_type: row.document_type,
      workspace_id: row.workspace_id,
      agent_run_id: row.agent_run_id,
      generated_at: row.generated_at,
      week_label: row.week_label,
      headline: row.headline,
      sections: row.sections,
      actions: row.actions,
      recommended_next_steps: row.recommended_next_steps,
      chart_suggestions: chartSuggestions,
      hypothesis_updates: row.hypothesis_updates || [],
      skills_included: row.skills_included,
      skills_omitted: row.skills_omitted,
      total_word_count: row.total_word_count,
      tokens_used: row.tokens_used,
      orchestrator_run_id: row.orchestrator_run_id,
    };
  }));
}

export async function getReportDocumentById(
  workspaceId: string,
  reportId: string
): Promise<ReportDocument | null> {
  const result = await query(`
    SELECT * FROM report_documents
    WHERE workspace_id = $1
      AND id = $2
    LIMIT 1
  `, [workspaceId, reportId]);

  if (!result.rows[0]) return null;

  const row = result.rows[0];
  const chartSuggestions = await getChartSuggestionsForReport(row.id);

  return {
    id: row.id,
    document_type: row.document_type,
    workspace_id: row.workspace_id,
    agent_run_id: row.agent_run_id,
    generated_at: row.generated_at,
    week_label: row.week_label,
    headline: row.headline,
    sections: row.sections,
    actions: row.actions,
    recommended_next_steps: row.recommended_next_steps,
    chart_suggestions: chartSuggestions,
    hypothesis_updates: row.hypothesis_updates || [],
    skills_included: row.skills_included,
    skills_omitted: row.skills_omitted,
    total_word_count: row.total_word_count,
    tokens_used: row.tokens_used,
    orchestrator_run_id: row.orchestrator_run_id,
  };
}
