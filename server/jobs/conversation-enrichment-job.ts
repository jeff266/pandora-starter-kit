import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';
import { getWorkspaceMethodology } from '../config/get-workspace-methodology.js';
import type { MethodologyFramework } from '../config/methodology-frameworks.js';

export interface EnrichmentJobResult {
  processed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  frameworkId: string | null;
}

const ENRICHMENT_VERSION = 1;

function extractCustomerExcerpt(transcript: string, maxChars = 800): string {
  if (!transcript) return '';
  const lines = transcript.split('\n');
  const customerLines: string[] = [];
  const customerPrefixes = /^(customer|buyer|client|prospect|contact|interviewer|them|their|he|she|they)[\s:]/i;
  const repPrefixes = /^(rep|sales|account exec|ae|csm|demo|host|presenter|me|my|i |we )[\s:]/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (customerPrefixes.test(trimmed) || (!repPrefixes.test(trimmed) && customerLines.length < 8)) {
      customerLines.push(trimmed);
    }
    if (customerLines.join(' ').length >= maxChars) break;
  }

  const combined = customerLines.join(' ').slice(0, maxChars);
  return combined.length > 50 ? combined : transcript.slice(0, maxChars);
}

function buildParticipantContext(participants: any): string {
  if (!participants || !Array.isArray(participants)) return 'Unknown participants';
  const parts = participants.map((p: any) => {
    const role = p.role || p.title || '';
    const affiliation = p.affiliation || (p.is_internal ? 'internal' : 'customer');
    return role ? `${role} (${affiliation})` : affiliation;
  });
  return parts.join(', ') || 'Unknown participants';
}

export function buildMethodologyPromptSection(framework: MethodologyFramework): string {
  const dimensionSchema = framework.dimensions.map(d => `{
    "dimension_id": "${d.id}",
    "dimension_label": "${d.label}",
    "covered": false,
    "confidence": "high|medium|low",
    "evidence_phrases": [],
    "gap_description": null
    // Positive signals to look for: ${d.positive_signals.slice(0, 2).join('; ')}
    // Negative signals: ${d.negative_signals.slice(0, 1).join('; ')}
  }`).join(',\n  ');

  return `{
  "framework": "${framework.id}",
  "dimensions": [
    ${dimensionSchema}
  ]
}`;
}

export function buildEnrichmentPrompt(
  excerpt: string,
  participantContext: string,
  durationMinutes: number,
  methodology: MethodologyFramework | null,
): string {
  return `Classify this sales call transcript across six dimensions.
Return only valid JSON. No preamble.

Transcript (max 800 chars): ${excerpt}
Participants: ${participantContext}
Duration: ${durationMinutes} minutes

{
  "call_quality": {
    "is_substantive": false,
    "customer_talk_pct_estimate": 0,
    "rep_talk_pct_estimate": 0,
    "longest_rep_monologue": "short|medium|long",
    "questions_asked_by_rep": 0,
    "call_energy": "high|medium|low",
    "next_steps_agreed": false,
    "action_items": [{"owner": "customer|rep|unclear", "description": ""}]
  },
  "buyer_signals": {
    "signals": [{"signal_type": "", "description": "", "confidence": "high|medium|low"}],
    "verbalized_use_case": false,
    "verbalized_success_metric": false,
    "decision_criteria_discussed": false,
    "technical_depth": "none|surface|deep",
    "executive_present": false,
    "champion_language": false,
    "asked_about_pricing": false,
    "referenced_internal_discussions": false
  },
  "competition": {
    "mentions": [{"name": "", "context": "", "sentiment": "positive|negative|neutral"}],
    "pricing_discussed": false,
    "alternatives_mentioned": false
  },
  "objections": {
    "raised": [{"type": "", "description": "", "resolved": false}],
    "blocking_objection_present": false
  },
  "sentiment": {
    "overall": "positive|neutral|negative",
    "buyer_engagement_quality": "high|medium|low"
  },
  "relationship": {
    "champion_signals_present": false,
    "champion_indicator_phrases": [],
    "new_stakeholder_introduced": false,
    "executive_sponsor_language": false,
    "stakeholder_count_estimate": 0
  }${methodology ? `,"methodology": ${buildMethodologyPromptSection(methodology)}` : ''}
}`;
}

function mapLongestMonologue(val: string | undefined): number | null {
  if (!val) return null;
  if (val === 'short') return 60;
  if (val === 'medium') return 120;
  if (val === 'long') return 300;
  return null;
}

export async function runConversationEnrichmentJob(
  workspaceId: string,
): Promise<EnrichmentJobResult> {
  const startTime = Date.now();
  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let methodologyCount = 0;

  const framework = await getWorkspaceMethodology(workspaceId);

  const convsResult = await query<{
    id: string;
    deal_id: string;
    transcript_text: string;
    participants: any;
    duration_seconds: number | null;
    talk_listen_ratio: any;
    source_data: any;
    call_date: Date;
  }>(
    `SELECT
       c.id,
       c.deal_id,
       c.transcript_text,
       c.participants,
       c.duration_seconds,
       c.talk_listen_ratio,
       c.source_data,
       c.call_date
     FROM conversations c
     WHERE c.workspace_id = $1
       AND c.deal_id IS NOT NULL
       AND (c.is_internal = false OR c.is_internal IS NULL)
       AND c.call_date >= NOW() - INTERVAL '8 days'
       AND c.transcript_text IS NOT NULL
       AND LENGTH(c.transcript_text) > 200
       AND NOT EXISTS (
         SELECT 1 FROM conversation_enrichments ce
         WHERE ce.conversation_id = c.id
           AND ce.enrichment_version = $2
       )
     ORDER BY c.call_date DESC`,
    [workspaceId, ENRICHMENT_VERSION],
  );

  if (convsResult.rows.length === 0) {
    return { processed: 0, failed: 0, skipped: 0, durationMs: Date.now() - startTime, frameworkId: framework?.id ?? null };
  }

  for (const conv of convsResult.rows) {
    try {
      const excerpt = extractCustomerExcerpt(conv.transcript_text, 800);
      if (!excerpt) { skipped++; continue; }

      const participantContext = buildParticipantContext(conv.participants);
      const durationMinutes = conv.duration_seconds ? Math.round(conv.duration_seconds / 60) : 0;

      const talkRatio = conv.talk_listen_ratio?.talk_ratio ?? null;

      const gongNativeMetrics = conv.source_data ? {
        talk_ratio: talkRatio,
        duration: conv.source_data.duration ?? null,
      } : null;

      const prompt = buildEnrichmentPrompt(excerpt, participantContext, durationMinutes, framework);

      const llmResponse = await callLLM(workspaceId, 'extract', {
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 1500,
        temperature: 0.1,
      });

      const contentVal = llmResponse.content as any;
      const rawContent = typeof contentVal === 'string'
        ? contentVal
        : (Array.isArray(contentVal)
            ? contentVal.map((b: any) => b.text ?? '').join('')
            : String(contentVal));

      let parsed: any;
      try {
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(rawContent);
      } catch {
        console.warn(`[EnrichmentJob] JSON parse error for conversation ${conv.id} — skipping`);
        failed++;
        await sleep(200);
        continue;
      }

      const cq = parsed.call_quality ?? {};
      const bs = parsed.buyer_signals ?? {};
      const comp = parsed.competition ?? {};
      const obj = parsed.objections ?? {};
      const sent = parsed.sentiment ?? {};
      const rel = parsed.relationship ?? {};
      const meth = parsed.methodology ?? null;

      const competitorMentions = Array.isArray(comp.mentions)
        ? comp.mentions.filter((m: any) => m.name)
        : [];
      const objRaised = Array.isArray(obj.raised)
        ? obj.raised
        : [];
      const actionItems = Array.isArray(cq.action_items) ? cq.action_items : [];

      const methodologyCoverage = meth?.dimensions ?? [];
      const methodologyGaps = methodologyCoverage
        .filter((d: any) => !d.covered && d.gap_description)
        .map((d: any) => ({
          dimension_id: d.dimension_id,
          dimension_label: d.dimension_label,
          gap_description: d.gap_description,
        }));
      const methodologyScore = methodologyCoverage.length > 0
        ? Math.round((methodologyCoverage.filter((d: any) => d.covered).length / methodologyCoverage.length) * 100)
        : null;

      if (methodologyCoverage.length > 0) methodologyCount++;

      await query(
        `INSERT INTO conversation_enrichments (
           workspace_id, conversation_id, deal_id, enrichment_version,
           is_substantive, customer_talk_pct, rep_talk_pct, longest_rep_monologue_seconds,
           questions_asked_by_rep, call_energy, next_steps_agreed, action_items_count, action_items,
           buyer_signals, buyer_verbalized_use_case, buyer_verbalized_success_metric,
           decision_criteria_discussed, technical_depth, executive_present, champion_language,
           buyer_asked_about_pricing, buyer_referenced_internal_discussions,
           competitor_mentions, competitor_count, competitive_intensity, pricing_discussed,
           alternatives_mentioned,
           objections_raised, objection_count, unresolved_objection_count, blocking_objection_present,
           sentiment, buyer_engagement_quality,
           champion_present, champion_email, new_stakeholder_introduced,
           executive_sponsor_language, stakeholder_count_on_call,
           methodology_framework, methodology_coverage, methodology_score, methodology_gaps,
           deepseek_model_used, enrichment_duration_ms, transcript_chars_processed,
           confidence_overall, gong_native_metrics
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, $8,
           $9, $10, $11, $12, $13,
           $14, $15, $16,
           $17, $18, $19, $20,
           $21, $22,
           $23, $24, $25, $26,
           $27,
           $28, $29, $30, $31,
           $32, $33,
           $34, $35, $36,
           $37, $38,
           $39, $40, $41, $42,
           $43, $44, $45,
           $46, $47
         )
         ON CONFLICT (conversation_id, enrichment_version) DO UPDATE SET
           is_substantive = EXCLUDED.is_substantive,
           customer_talk_pct = EXCLUDED.customer_talk_pct,
           rep_talk_pct = EXCLUDED.rep_talk_pct,
           longest_rep_monologue_seconds = EXCLUDED.longest_rep_monologue_seconds,
           questions_asked_by_rep = EXCLUDED.questions_asked_by_rep,
           call_energy = EXCLUDED.call_energy,
           next_steps_agreed = EXCLUDED.next_steps_agreed,
           action_items_count = EXCLUDED.action_items_count,
           action_items = EXCLUDED.action_items,
           buyer_signals = EXCLUDED.buyer_signals,
           buyer_verbalized_use_case = EXCLUDED.buyer_verbalized_use_case,
           buyer_verbalized_success_metric = EXCLUDED.buyer_verbalized_success_metric,
           decision_criteria_discussed = EXCLUDED.decision_criteria_discussed,
           technical_depth = EXCLUDED.technical_depth,
           executive_present = EXCLUDED.executive_present,
           champion_language = EXCLUDED.champion_language,
           buyer_asked_about_pricing = EXCLUDED.buyer_asked_about_pricing,
           buyer_referenced_internal_discussions = EXCLUDED.buyer_referenced_internal_discussions,
           competitor_mentions = EXCLUDED.competitor_mentions,
           competitor_count = EXCLUDED.competitor_count,
           competitive_intensity = EXCLUDED.competitive_intensity,
           pricing_discussed = EXCLUDED.pricing_discussed,
           alternatives_mentioned = EXCLUDED.alternatives_mentioned,
           objections_raised = EXCLUDED.objections_raised,
           objection_count = EXCLUDED.objection_count,
           unresolved_objection_count = EXCLUDED.unresolved_objection_count,
           blocking_objection_present = EXCLUDED.blocking_objection_present,
           sentiment = EXCLUDED.sentiment,
           buyer_engagement_quality = EXCLUDED.buyer_engagement_quality,
           champion_present = EXCLUDED.champion_present,
           new_stakeholder_introduced = EXCLUDED.new_stakeholder_introduced,
           executive_sponsor_language = EXCLUDED.executive_sponsor_language,
           stakeholder_count_on_call = EXCLUDED.stakeholder_count_on_call,
           methodology_framework = EXCLUDED.methodology_framework,
           methodology_coverage = EXCLUDED.methodology_coverage,
           methodology_score = EXCLUDED.methodology_score,
           methodology_gaps = EXCLUDED.methodology_gaps,
           enrichment_duration_ms = EXCLUDED.enrichment_duration_ms,
           updated_at = now()`,
        [
          workspaceId,
          conv.id,
          conv.deal_id,
          ENRICHMENT_VERSION,
          cq.is_substantive ?? null,
          cq.customer_talk_pct_estimate ?? null,
          cq.rep_talk_pct_estimate ?? null,
          mapLongestMonologue(cq.longest_rep_monologue),
          typeof cq.questions_asked_by_rep === 'number' ? cq.questions_asked_by_rep : null,
          cq.call_energy ?? null,
          cq.next_steps_agreed ?? null,
          actionItems.length,
          JSON.stringify(actionItems),
          JSON.stringify(Array.isArray(bs.signals) ? bs.signals : []),
          bs.verbalized_use_case ?? null,
          bs.verbalized_success_metric ?? null,
          bs.decision_criteria_discussed ?? null,
          bs.technical_depth ?? null,
          bs.executive_present ?? null,
          bs.champion_language ?? null,
          bs.asked_about_pricing ?? null,
          bs.referenced_internal_discussions ?? null,
          JSON.stringify(competitorMentions),
          competitorMentions.length,
          competitorMentions.length === 0 ? 'none' : competitorMentions.length <= 2 ? 'light' : 'heavy',
          comp.pricing_discussed ?? null,
          comp.alternatives_mentioned ?? null,
          JSON.stringify(objRaised),
          objRaised.length,
          objRaised.filter((o: any) => !o.resolved).length,
          obj.blocking_objection_present ?? null,
          sent.overall ?? null,
          sent.buyer_engagement_quality ?? null,
          rel.champion_signals_present ?? null,
          null,
          rel.new_stakeholder_introduced ?? null,
          rel.executive_sponsor_language ?? null,
          typeof rel.stakeholder_count_estimate === 'number' ? rel.stakeholder_count_estimate : null,
          meth ? framework?.id ?? null : null,
          JSON.stringify(methodologyCoverage),
          methodologyScore,
          JSON.stringify(methodologyGaps),
          llmResponse.usage ? 'deepseek' : null,
          Date.now() - startTime,
          conv.transcript_text.length,
          'medium',
          gongNativeMetrics ? JSON.stringify(gongNativeMetrics) : null,
        ],
      );

      processed++;
    } catch (err) {
      console.error(`[EnrichmentJob] Error processing conversation ${conv.id}:`, err);
      failed++;
    }

    await sleep(200);
  }

  const durationMs = Date.now() - startTime;
  console.log(
    `[EnrichmentJob] ${processed} processed, ${failed} failed, ${skipped} skipped, ` +
    `${methodologyCount} methodology scores (framework: ${framework?.id ?? 'none'})`,
  );

  return { processed, failed, skipped, durationMs, frameworkId: framework?.id ?? null };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
