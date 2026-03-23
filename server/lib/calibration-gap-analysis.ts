import type { ExtractedReportData } from './report-image-parser.js';

export interface GapItem {
  dimension_key: string;
  dimension_label: string;
  crm_value: number | null;
  pandora_value: number | null;
  delta_pct: number | null;
  verdict: 'match' | 'minor_gap' | 'major_gap' | 'missing';
  recommendation: string;
}

export interface GapAnalysisResult {
  overall_match: 'strong' | 'partial' | 'weak';
  gaps: GapItem[];
  summary: string;
  next_steps: string[];
}

function pctDelta(a: number, b: number): number {
  if (b === 0) return a === 0 ? 0 : 100;
  return Math.round(Math.abs(a - b) / b * 100);
}

function verdict(delta: number | null): GapItem['verdict'] {
  if (delta === null) return 'missing';
  if (delta <= 5)  return 'match';
  if (delta <= 20) return 'minor_gap';
  return 'major_gap';
}

export async function analyzeGap(
  extracted: ExtractedReportData,
  pandoraValues: Record<string, number>
): Promise<GapAnalysisResult> {
  const gaps: GapItem[] = [];

  if (extracted.total_value !== null && pandoraValues.active_pipeline !== undefined) {
    const delta = pctDelta(pandoraValues.active_pipeline, extracted.total_value);
    const v = verdict(delta);
    gaps.push({
      dimension_key:   'active_pipeline',
      dimension_label: 'Active Pipeline',
      crm_value:       extracted.total_value,
      pandora_value:   pandoraValues.active_pipeline,
      delta_pct:       delta,
      verdict:         v,
      recommendation:  v === 'match'
        ? 'Pipeline definition is calibrated correctly.'
        : v === 'minor_gap'
        ? `Minor gap (${delta}%). Check whether close-date filters align.`
        : `Major gap (${delta}%). Your CRM shows ${fmtM(extracted.total_value)} but Pandora counts ${fmtM(pandoraValues.active_pipeline)}. Adjust stage or date filters.`,
    });
  }

  if (extracted.deal_count !== null && pandoraValues.active_pipeline_count !== undefined) {
    const delta = pctDelta(pandoraValues.active_pipeline_count, extracted.deal_count);
    const v = verdict(delta);
    gaps.push({
      dimension_key:   'active_pipeline_count',
      dimension_label: 'Deal Count',
      crm_value:       extracted.deal_count,
      pandora_value:   pandoraValues.active_pipeline_count,
      delta_pct:       delta,
      verdict:         v,
      recommendation:  v === 'match'
        ? 'Deal count matches.'
        : `${delta}% gap in deal count — likely a stage exclusion mismatch.`,
    });
  }

  const majorGaps   = gaps.filter(g => g.verdict === 'major_gap').length;
  const minorGaps   = gaps.filter(g => g.verdict === 'minor_gap').length;
  const overallMatch: GapAnalysisResult['overall_match'] =
    majorGaps > 0   ? 'weak'
    : minorGaps > 0 ? 'partial'
    : 'strong';

  const summary = overallMatch === 'strong'
    ? 'Pandora numbers match your CRM report closely. Calibration looks good.'
    : overallMatch === 'partial'
    ? `Found ${minorGaps} minor gap${minorGaps !== 1 ? 's' : ''}. Small filter adjustments recommended.`
    : `Found ${majorGaps} major gap${majorGaps !== 1 ? 's' : ''}. Calibration needs adjustment before reports can be trusted.`;

  const nextSteps: string[] = [];
  if (gaps.some(g => g.verdict === 'major_gap')) {
    nextSteps.push('Walk through the calibration interview to re-confirm your pipeline definition.');
  }
  if (extracted.filters_visible.length > 0) {
    nextSteps.push(`Verify your CRM report filters match Pandora: ${extracted.filters_visible.slice(0, 2).join(', ')}`);
  }
  if (nextSteps.length === 0) {
    nextSteps.push('No action needed — calibration is on track.');
  }

  return { overall_match: overallMatch, gaps, summary, next_steps: nextSteps };
}

function fmtM(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}
