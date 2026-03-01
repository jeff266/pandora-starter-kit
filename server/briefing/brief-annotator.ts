import type { AiBlurbs } from './brief-types.js';
import { callLLM } from '../utils/llm-router.js';
import { formatCompact } from './brief-utils.js';

export interface Claim {
  text: string;
  drilldown: string;
  verified?: boolean;
}

/**
 * Reads generated brief narrative prose and extracts verifiable numeric/factual claims.
 * Uses DeepSeek (extract capability) for structured JSON extraction — fast and cheap.
 * Each claim is verified against the structured brief data before being annotated.
 * If a claim cannot be verified, it is silently dropped (never blocks the brief).
 */
export async function annotateBriefNarrative(
  workspaceId: string,
  blurbs: AiBlurbs,
  data: { theNumber: any; whatChanged: any; reps: any[]; deals: any[] }
): Promise<AiBlurbs> {
  const allText = [
    blurbs.pulse_summary,
    blurbs.key_action,
    blurbs.overall_summary,
    blurbs.rep_conversation,
    blurbs.deal_recommendation,
    blurbs.week_summary,
    blurbs.next_week_focus,
    blurbs.quarter_situation,
    blurbs.close_plan,
  ].filter(Boolean).join(' ');

  if (!allText.trim()) return blurbs;

  const { theNumber: n, deals, reps } = data;

  const dataContext = [
    n?.attainment_pct != null ? `Attainment: ${n.attainment_pct.toFixed(0)}%` : '',
    n?.gap > 0 ? `Gap: ${formatCompact(n.gap)}` : '',
    n?.pipeline_total > 0 ? `Pipeline: ${formatCompact(n.pipeline_total)} across ${n.deal_count} deals` : '',
    n?.coverage_ratio != null ? `Coverage ratio: ${n.coverage_ratio}x` : '',
    n?.required_pipeline > 0 ? `Required pipeline: ${formatCompact(n.required_pipeline)}` : '',
    data.whatChanged?.total_pipeline_delta != null ? `Pipeline WoW change: ${formatCompact(data.whatChanged.total_pipeline_delta)}` : '',
    deals?.length > 0 ? `At-risk deals: ${deals.filter((d: any) => d.severity === 'critical' || d.severity === 'warning').map((d: any) => `${d.name} ($${(d.amount / 1000).toFixed(0)}K)`).join(', ')}` : '',
    reps?.length > 0 ? `Reps: ${reps.map((r: any) => r.name).join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const systemPrompt = `You extract verifiable factual claims from revenue briefing text that can be linked to underlying data.
Return ONLY valid JSON. No explanation. No markdown.

Supported drilldown types:
- "attainment" — for attainment percentage claims (e.g. "21% attainment", "at 21%")
- "gap" — for gap-to-target claims (e.g. "$278K gap", "gap of $278K")
- "pipeline_total" — for total pipeline amount claims (e.g. "$2.2M pipeline", "$2.2M in pipeline")
- "pipeline_change" — for week-over-week pipeline change claims (e.g. "pipeline dropped $2.6M", "lost $2.6M")
- "deals_at_risk" — for aggregate at-risk deal claims (e.g. "$607K across 4 deals", "4 at-risk deals")
- "deal:<name>" — for specific named deal (e.g. "deal:Behavioral Framework - AB")
- "rep:<name>" — for specific named rep (e.g. "rep:Nate Phillips")

Only extract claims where the text substring is an exact or near-exact match to something in the prose.
Only include claims you are confident about. Return empty array if unsure.`;

  const userPrompt = `TEXT:
${allText}

ACTUAL DATA:
${dataContext}

Return JSON: {"claims": [{"text": "<exact substring from text>", "drilldown": "<type>"}]}`;

  let rawClaims: Array<{ text: string; drilldown: string }> = [];

  try {
    const response = await callLLM(workspaceId, 'extract', {
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0,
      maxTokens: 300,
      _tracking: {
        workspaceId,
        phase: 'briefing',
        stepName: 'annotate-brief-narrative',
      },
    });

    const raw = typeof response === 'string' ? response : (response as any)?.content || '';
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    rawClaims = parsed.claims || [];
  } catch (err) {
    console.warn('[brief-annotator] LLM extraction failed, skipping annotation:', err instanceof Error ? err.message : String(err));
    return blurbs;
  }

  // Verify each claim against actual data
  const verifiedClaims: Claim[] = [];

  for (const claim of rawClaims) {
    if (!claim.text || !claim.drilldown) continue;

    // Check that the claim text actually appears in the prose (exact substring, case-insensitive)
    if (!allText.toLowerCase().includes(claim.text.toLowerCase())) continue;

    const dt = claim.drilldown;
    let verified = false;

    if (dt === 'attainment' && n?.attainment_pct != null) {
      verified = true;
    } else if (dt === 'gap' && n?.gap > 0) {
      verified = true;
    } else if (dt === 'pipeline_total' && n?.pipeline_total > 0) {
      verified = true;
    } else if (dt === 'pipeline_change' && data.whatChanged?.total_pipeline_delta != null) {
      verified = true;
    } else if (dt === 'deals_at_risk') {
      const atRisk = (deals || []).filter((d: any) => d.severity === 'critical' || d.severity === 'warning');
      verified = atRisk.length > 0;
    } else if (dt.startsWith('deal:')) {
      const dealName = dt.slice(5).toLowerCase();
      verified = (deals || []).some((d: any) => d.name?.toLowerCase().includes(dealName));
    } else if (dt.startsWith('rep:')) {
      const repName = dt.slice(4).toLowerCase();
      verified = (reps || []).some((r: any) => r.name?.toLowerCase().includes(repName));
    }

    if (verified) {
      verifiedClaims.push({ text: claim.text, drilldown: claim.drilldown, verified: true });
    }
  }

  if (verifiedClaims.length === 0) return blurbs;

  return { ...blurbs, claims: verifiedClaims };
}
