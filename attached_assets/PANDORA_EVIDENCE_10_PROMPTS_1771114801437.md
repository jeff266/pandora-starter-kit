# Evidence Population — Claude Code Mobile Prompts
# 10 prompts, send ONE at a time. Each is a single task.
# Copy everything between the ═══ lines.


═══════════════════════════════════════════════════════════
PROMPT 1: Read the codebase and confirm what exists
═══════════════════════════════════════════════════════════

Read these files and summarize what you find. Do NOT 
modify anything yet.

1. server/skills/types.ts — look for SkillEvidence, 
   EvidenceClaim, EvaluatedRecord, DataSourceContribution, 
   SkillParameter types
2. server/skills/runtime.ts — how skills execute step by step, 
   where results get saved to skill_runs table
3. server/skills/library/pipeline-hygiene.ts — the compute step 
   output shape, the classify step output, and what the final 
   step returns
4. server/agents/runtime.ts — look for skillEvidence accumulation
5. List all files in server/skills/library/

Tell me:
- Do the SkillEvidence types exist?
- What does pipeline-hygiene's compute step return? (field names)
- What does the final step currently return?
- Does the skill runtime store result.evidence in skill_runs?
- How many skill files exist in the library?


═══════════════════════════════════════════════════════════
PROMPT 2: Create the EvidenceBuilder utility
═══════════════════════════════════════════════════════════

Create server/skills/evidence-builder.ts

A builder class that skills use to assemble evidence:

- addClaim(claim: EvidenceClaim): this
- addRecord(record: EvaluatedRecord): this
- addRecords(records: EvaluatedRecord[]): this
- addDataSource(source: DataSourceContribution): this
- addParameter(param: SkillParameter): this
- build(): SkillEvidence — returns { claims, evaluated_records, data_sources, parameters }

Import types from ./types.ts (the SkillEvidence types 
from last session).

Also add a helper function:

buildDataSources(workspaceId: string, relevantSources: string[])
→ Promise<DataSourceContribution[]>

This queries the database (connector_configs or connections 
table) to find which sources are connected for this workspace, 
their last sync time, and record counts. CRITICAL: include 
disconnected sources too with connected: false and a note 
like "Not connected — data incomplete".

Also add:

dealToEvaluatedRecord(deal: any, fields: Record<string, any>, 
  flags: Record<string, string>, severity: string)
→ EvaluatedRecord

Maps deal.id, deal.name, deal.owner_email, deal.owner_name 
into the standard shape. Handle field name variations 
(deal_id vs id, ownerEmail vs owner_email, etc).

Verify it compiles with no errors.


═══════════════════════════════════════════════════════════
PROMPT 3: Wire evidence into pipeline-hygiene
═══════════════════════════════════════════════════════════

Read server/skills/evidence-builder.ts (you just built it) 
and server/skills/library/pipeline-hygiene.ts.

Find where pipeline-hygiene's final step returns its result.
Modify it to also return structured evidence:

1. Import EvidenceBuilder, buildDataSources, dealToEvaluatedRecord
2. Create builder, add 3 parameters:
   - stale_threshold_days (from workspace config or default 30)
   - critical_stale_days (default 45)
   - amount_threshold (default 50000)
3. Call buildDataSources(workspaceId, ['hubspot','salesforce','gong','fireflies'])
4. Loop ALL deals from compute output → addRecord() for each:
   - fields: stage, amount, close_date, last_activity_date, days_since_activity, activity_count
   - flags: stale_flag (stale/active), close_date_flag (past_due/on_time), severity, recommended_action
5. Add claims: stale_deals (if any), past_due_close_dates (if any)
   Each claim gets entity_ids = array of deal UUIDs
6. Return { narrative: claudeOutput, evidence: builder.build() }

Add to Claude prompt template (~50 extra tokens):
"Include [claim_id] in brackets for each finding, e.g.:
[stale_deals] 4 deals worth $380K are stale."

Then verify skill runtime stores evidence in skill_runs:
find where results save to skill_runs table, confirm 
result.evidence flows into result_data JSONB. Add 5MB 
truncation: if evidence > 5MB, slice evaluated_records 
to 500 and set _truncated = true.


═══════════════════════════════════════════════════════════
PROMPT 4: Test pipeline-hygiene evidence
═══════════════════════════════════════════════════════════

Run pipeline-hygiene against the first active workspace 
that has connected sources.

After the run, query skill_runs for the latest result:

SELECT result_data FROM skill_runs 
WHERE skill_id = 'pipeline-hygiene' 
ORDER BY started_at DESC LIMIT 1;

Verify and print:
- result_data.evidence exists? (yes/no)
- claims count and each claim_id
- evaluated_records count
- data_sources count and which are connected
- parameters count and stale_threshold_days value
- Cross-check: do claim entity_ids exist in evaluated_records?

If anything is missing or broken, fix it before proceeding.


═══════════════════════════════════════════════════════════
PROMPT 5: Wire evidence into deal-risk-review + single-thread-alert
═══════════════════════════════════════════════════════════

Read pipeline-hygiene as the reference. Apply the exact 
same EvidenceBuilder pattern to these two skills:

deal-risk-review:
- Records: all deals evaluated
- Fields: stage, amount, close_date, days_in_stage, probability, risk_score
- Flags: risk_level (high/medium/low), primary_risk_factor
- Claims: high_risk_deals, stalled_in_stage
- Parameters: risk_score_threshold, days_in_stage_multiplier
- Add [claim_id] to Claude prompt

single-thread-alert:
- Records: all deals evaluated
- Fields: stage, amount, contact_count, unique_roles, unique_departments, champion_identified
- Flags: threading_status, has_champion, has_economic_buyer
- Claims: single_threaded_deals, no_champion_deals, high_value_single_thread
- Parameters: single_thread_threshold, high_value_threshold
- Add [claim_id] to Claude prompt

Run both against the active workspace. Print evidence 
summary for each: "{skillId}: {claims} claims, 
{records} records, {sources} sources, {params} parameters"


═══════════════════════════════════════════════════════════
PROMPT 6: Wire evidence into data-quality-audit + weekly-recap + forecast-rollup
═══════════════════════════════════════════════════════════

Same EvidenceBuilder pattern for these three:

data-quality-audit:
- Records: all deals, Fields: stage, amount, field_fill_rate, missing_fields, has_contacts
- Flags: completeness_grade (A-F), worst_gap
- Claims: low_fill_rate_deals, orphaned_deals, missing_required_fields
- Parameters: completeness_threshold_pct

weekly-recap:
- Records: deals that changed, Fields: previous_stage, current_stage, amount, movement_type
- Flags: movement_quality
- Claims: deals_advanced, deals_lost, deals_created, deals_won
- Parameters: recap_window_days

forecast-rollup:
- Records: all open deals, Fields: forecast_category, amount, probability, close_date, weighted_amount
- Flags: forecast_risk, category_movement
- Claims: landing_zone, pacing_gap, concentrated_commit, stalled_commits
- Parameters: bear_case_factor, best_case_factor, pipeline_factor

Run each. Print evidence summary.


═══════════════════════════════════════════════════════════
PROMPT 7: Wire evidence into rep/stage-level skills
═══════════════════════════════════════════════════════════

These skills have non-deal entity types. Read the 
evidenceSchema.entity_type from each skill definition 
to confirm.

pipeline-coverage (entity_type: rep):
- Records: one per rep, entity_id = rep email
- Fields: quota, pipeline_total, commit, coverage_ratio, gap, deal_count
- Flags: status (on_track/at_risk/behind), coverage_health
- Claims: reps_below_coverage, team_coverage_gap
- Parameters: coverage_target, quota_period

rep-scorecard (entity_type: rep):
- Records: one per rep
- Fields: overall_score, attainment_pct, pipeline_coverage, activity_score
- Flags: trend, performance_tier
- Claims: top_performers, needs_coaching
- Parameters: scorecard weight configs

pipeline-waterfall (entity_type: deal):
- Records: deals with stage movements
- Fields: amount, from_stage, to_stage, movement_date, days_in_from_stage
- Flags: movement_type
- Claims: stage_bottleneck, premature_advances, surprise_losses

bowtie-analysis (entity_type: stage):
- Records: one per stage
- Fields: stage_name, entry_count, exit_count, conversion_rate, avg_time_in_stage
- Flags: bottleneck, improvement_trend
- Claims: conversion_bottleneck, slowest_stage, leakage_point

For remaining skills (project-recap, strategy-insights, 
workspace-config-audit, custom-field-discovery, 
contact-role-resolution, icp-discovery, lead-scoring, 
pipeline-goals): add minimal evidence — parameters + 
data_sources only, empty claims/records with TODO comment.
Don't break them.

Run pipeline-coverage and verify entity_type = 'rep' 
in evaluated_records. Print summary.


═══════════════════════════════════════════════════════════
PROMPT 8: CWD compute functions
═══════════════════════════════════════════════════════════

Create two new files:

1. server/skills/tools/check-workspace-has-conversations.ts

Returns { has_conversations: boolean, conversation_count: number, 
sources: string[] }

SQL: SELECT COUNT(*), ARRAY_AGG(DISTINCT source) 
FROM conversations WHERE workspace_id = $1
If table doesn't exist or is empty, return { false, 0, [] }.

2. server/skills/tools/audit-conversation-deal-coverage.ts

Returns conversations where deal_id IS NULL, classified:
- HIGH severity: title contains demo/product/discovery/pricing, 
  7+ days old, account has no open deals
- MEDIUM: recent (<7 days) OR account has other deals
- LOW: short (<10 min) or very old (>90 days)

Infer cause: deal_not_created, deal_linking_gap, 
disqualified_unlogged, early_stage

Return top 5 by severity with conversation_id, title, 
account_name, rep_name, days_since_call, severity, likely_cause.

Register both in the tool registry.

Wire into data-quality-audit: if workspace has conversations, 
add a conversations_without_deals claim to evidence.

Test: run data-quality-audit. If conversations exist, verify 
CWD claim appears. If none exist, verify graceful skip.


═══════════════════════════════════════════════════════════
PROMPT 9: Adapter registration + template fix
═══════════════════════════════════════════════════════════

Two quick fixes:

1. Gong + Fireflies adapter registration.
Server logs show they're not registered:
[AdapterRegistry] Registered tasks adapter: monday
[AdapterRegistry] Registered documents adapter: google-drive
[AdapterRegistry] Registered crm adapter: salesforce

Find the adapter registration file and add gong + fireflies 
as conversation adapters. The connector code already exists — 
it just needs to be wired in.

2. Template seeding fix.
Server logs: [TemplateSeed] Failed to seed template {} (×5)
Find the seeding code, identify the malformed data, fix it.

Verify both by checking server startup logs after restart.


═══════════════════════════════════════════════════════════
PROMPT 10: E2E test
═══════════════════════════════════════════════════════════

Create and run server/tests/evidence-e2e.test.ts

A standalone script: npx tsx server/tests/evidence-e2e.test.ts

16 tests in 5 phases:

Phase 1 — Structure (no DB): 
1.1 SkillEvidence types import, 1.2 EvidenceBuilder works, 
1.3 all skills have evidenceSchema, 1.4 AgentRunResult has 
skillEvidence, 1.5 agent_runs has skill_evidence column, 
1.6 CWD functions import, 1.7 buildDataSources exists

Phase 2 — Data (needs DB):
2.1 buildDataSources returns valid array, 
2.2 checkWorkspaceHasConversations returns valid structure

Phase 3 — Skills (needs LLM keys):
3.1 pipeline-hygiene evidence complete + cross-reference check,
3.2 evidence persisted in skill_runs,
3.3 single-thread-alert evidence complete,
3.4 pipeline-coverage has entity_type=rep

Phase 4 — Agent:
4.1 pipeline-state agent accumulates skillEvidence from 
all composed skills, persisted in agent_runs

Phase 5 — Edge cases:
5.1 empty evidence valid, 5.2 5MB truncation works

Print summary table, exit 0 if all pass, exit 1 if any fail.
Fix failures before done.
