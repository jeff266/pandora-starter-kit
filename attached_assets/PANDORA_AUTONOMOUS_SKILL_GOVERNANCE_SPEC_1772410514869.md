# Claude Code Prompt: Autonomous Skill Governance Layer

## Context

T005–T007 built the feedback capture and self-heal suggestion pipeline. Pandora can now detect when its answers fail (thumbs-down, repeated questions) and propose fixes (resolver patterns, workspace context additions, named filters).

But proposing fixes is safe. *Applying* them is dangerous. This prompt builds the governance layer that sits between "suggestion generated" and "change deployed." Without this layer, Phase 2 auto-apply is reckless — the system could write broken tools, degrade existing answers, or make changes nobody understands.

**Five governance agents, each answering one question:**

1. **Shape Validator** — "Will this change break anything?"
2. **Review Agent** — "Is this change good enough to ship?"
3. **Explainer Agent** — "What does this change do, in words a sales leader would understand?"
4. **Rollback Engine** — "Can we undo this instantly if it goes wrong?"
5. **Comparison Engine** — "Prove this is better than what we have."

**Philosophy:** Pandora earns the right to self-modify through transparency. Every autonomous change must be explainable, reversible, and provably better. The admin sees exactly what will change, why, what it replaces, and can undo it with one click.

---

## Before You Start

**Read these files first:**

1. `server/routes/agent-feedback.ts` — The self-heal review endpoint (T007). You're consuming its output.
2. `server/chat/feedback-analyzer.ts` — Pattern analysis that feeds T007.
3. `PANDORA_SKILL_DESIGN_GUIDE.md` — The three-phase pattern. The shape validator enforces this for any auto-generated skills.
4. `server/skills/registry.ts` — How skills are registered. The governance layer must validate against this contract.
5. `server/config/workspace-config-loader.ts` — How workspace context is loaded. Context additions modify this.
6. `server/config/config-suggestions.ts` — The existing suggestion system. Governance extends this pattern.
7. `server/chat/orchestrator.ts` — The chat router. Resolver patterns modify this.

---

## Task 1: Schema — Governance Records

Create migration `XXX_skill_governance.sql`:

```sql
-- ================================================================
-- Governance records track every autonomous change through its
-- full lifecycle: proposed → validated → reviewed → approved/rejected
-- → deployed → monitored → (rolled back if needed)
-- ================================================================

CREATE TABLE skill_governance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- What triggered this
  source_type TEXT NOT NULL,             -- 'self_heal', 'feedback_pattern', 'drift_detection', 'manual'
  source_id TEXT,                        -- agent_feedback.id or config_suggestion.id that spawned this
  source_feedback_ids TEXT[],            -- All feedback IDs that contributed to this proposal

  -- What is being proposed
  change_type TEXT NOT NULL,             -- 'resolver_pattern', 'workspace_context', 'named_filter',
                                         -- 'skill_definition', 'agent_config'
  change_description TEXT NOT NULL,      -- Human-readable: "Add a resolver for 'pipeline coverage' questions..."
  change_payload JSONB NOT NULL,         -- The actual change definition (type-specific, see below)

  -- What it replaces (null if net-new)
  supersedes_id UUID REFERENCES skill_governance(id),  -- Previous governance record this replaces
  supersedes_type TEXT,                  -- What existing thing this replaces
  supersedes_snapshot JSONB,             -- Frozen copy of the thing being replaced (for rollback)

  -- Validation results
  shape_validation JSONB DEFAULT '{}',   -- Output from Shape Validator agent
  shape_valid BOOLEAN,                   -- Pass/fail
  shape_errors TEXT[],                   -- Specific validation failures

  -- Review results
  review_result JSONB DEFAULT '{}',      -- Output from Review Agent
  review_score NUMERIC,                  -- 0-1 quality score
  review_recommendation TEXT,            -- 'approve', 'reject', 'needs_revision'
  review_concerns TEXT[],                -- Specific concerns raised

  -- Human-language explanation
  explanation JSONB DEFAULT '{}',        -- Output from Explainer Agent
  explanation_summary TEXT,              -- One-sentence: "This teaches Pandora that..."
  explanation_detail TEXT,               -- Full explanation for admin review
  explanation_impact TEXT,               -- "This will change how Pandora answers questions about..."

  -- Comparison results (before/after)
  comparison JSONB DEFAULT '{}',         -- Output from Comparison Engine
  comparison_test_cases JSONB,           -- Test inputs used for comparison
  comparison_before_results JSONB,       -- How the system answered BEFORE
  comparison_after_results JSONB,        -- How the system would answer AFTER
  comparison_improvement_score NUMERIC,  -- -1 to 1 (negative = regression)

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'proposed',
  -- proposed → validating → validated → reviewing → reviewed →
  -- pending_approval → approved → deploying → deployed → monitoring →
  -- (stable | rolled_back | superseded)
  status_history JSONB DEFAULT '[]',     -- [{ status, timestamp, actor, reason }]

  -- Deployment
  deployed_at TIMESTAMPTZ,
  deployed_by TEXT,                      -- 'auto' or admin email
  trial_expires_at TIMESTAMPTZ,          -- deployed_at + 7 days for auto-applied changes
  
  -- Monitoring (post-deployment)
  monitoring_start TIMESTAMPTZ,
  monitoring_feedback_before JSONB,      -- Feedback stats in the 7 days before deployment
  monitoring_feedback_after JSONB,       -- Feedback stats in the 7 days after deployment
  monitoring_verdict TEXT,               -- 'improved', 'no_change', 'degraded'

  -- Rollback
  rolled_back_at TIMESTAMPTZ,
  rolled_back_by TEXT,
  rollback_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_governance_workspace_status
  ON skill_governance(workspace_id, status, created_at DESC);
CREATE INDEX idx_governance_workspace_type
  ON skill_governance(workspace_id, change_type);
CREATE INDEX idx_governance_deployed
  ON skill_governance(workspace_id) WHERE status = 'deployed';
CREATE INDEX idx_governance_monitoring
  ON skill_governance(workspace_id) WHERE status = 'monitoring';
```

### change_payload shapes by type

Document these as TypeScript interfaces:

```typescript
// When change_type = 'resolver_pattern'
interface ResolverPatternPayload {
  pattern: string;               // Regex string: "pipeline\\s+coverage"
  pattern_flags: string;         // "i" for case-insensitive
  intent: string;                // What this pattern matches: "pipeline_coverage_query"
  response_template: string;     // How to respond: "Your pipeline coverage is {{coverage}}x..."
  data_query: string;            // SQL or skill reference to get the data
  priority: number;              // Where in the resolver chain (lower = checked first)
  test_inputs: string[];         // Example questions this should match
  test_non_matches: string[];    // Example questions this should NOT match
}

// When change_type = 'workspace_context'
interface WorkspaceContextPayload {
  context_key: string;           // e.g. "team.sara_role"
  context_value: string;         // e.g. "Sara is an SDR, not an AE — she doesn't own deals"
  context_category: string;      // Where in the context hierarchy: "team", "process", "terminology"
  injection_point: string;       // Where this gets injected: "system_prompt", "skill_context", "both"
  confidence: number;            // From the self-heal analysis
  evidence: string;              // Why we believe this: "3 users asked about Sara's deals..."
}

// When change_type = 'named_filter'
interface NamedFilterPayload {
  filter_name: string;           // "enterprise_deals"
  filter_slug: string;           // "enterprise-deals"
  description: string;           // "Deals with amount > $100K in the Core Sales pipeline"
  filter_definition: {
    entity_type: 'deal' | 'contact' | 'account';
    conditions: Array<{
      field: string;
      operator: string;
      value: any;
    }>;
  };
  suggested_aliases: string[];   // ["enterprise", "big deals", "large deals"]
}

// When change_type = 'skill_definition' (Phase 3 — future)
interface SkillDefinitionPayload {
  skill_id: string;
  skill_name: string;
  description: string;
  category: string;
  steps: Array<{
    id: string;
    phase: 'compute' | 'classify' | 'synthesize';
    description: string;
    // Compute steps: SQL query
    query?: string;
    // Classify steps: prompt template + model
    prompt_template?: string;
    model?: string;
    // Synthesize steps: prompt template
    synthesis_prompt?: string;
  }>;
  input_schema: Record<string, any>;   // What data this skill needs
  output_schema: Record<string, any>;  // What this skill produces
}
```

---

## Task 2: Shape Validator Agent

**Question it answers:** "Will this change break anything?"

**File:** `server/governance/shape-validator.ts`

The shape validator checks that a proposed change conforms to Pandora's structural contracts. It does NOT evaluate whether the change is *good* — just whether it's *safe to deploy*.

```typescript
interface ShapeValidationResult {
  valid: boolean;
  errors: string[];                // Hard failures — cannot deploy
  warnings: string[];              // Soft concerns — can deploy but watch
  checks_performed: string[];      // What was checked
}

export async function validateChangeShape(
  workspaceId: string,
  changeType: string,
  payload: any
): Promise<ShapeValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: string[] = [];

  switch (changeType) {
    case 'resolver_pattern':
      checks.push('regex_syntax', 'response_template_vars', 'data_query_exists',
                   'no_collision_with_existing', 'test_inputs_match', 'test_non_matches_clear');
      
      // Check 1: Is the regex valid?
      try {
        new RegExp(payload.pattern, payload.pattern_flags || '');
      } catch (e) {
        errors.push(`Invalid regex pattern: ${e.message}`);
      }

      // Check 2: Does the response template reference valid variables?
      const templateVars = (payload.response_template || '').match(/\{\{(\w+)\}\}/g) || [];
      // These must map to fields the data_query can provide
      checks.push(`template_vars: ${templateVars.join(', ')}`);

      // Check 3: Does the pattern collide with existing resolvers?
      // Load existing resolver patterns and test for overlap
      try {
        const existingResolvers = await loadExistingResolvers(workspaceId);
        const newRegex = new RegExp(payload.pattern, payload.pattern_flags || '');
        for (const existing of existingResolvers) {
          // Test each of the new pattern's test_inputs against existing patterns
          for (const testInput of (payload.test_inputs || [])) {
            if (existing.pattern.test(testInput)) {
              warnings.push(
                `Test input "${testInput}" also matches existing resolver "${existing.intent}". ` +
                `Priority ordering will determine which fires first.`
              );
            }
          }
        }
      } catch (e) {
        warnings.push(`Could not check existing resolvers: ${e.message}`);
      }

      // Check 4: Do test inputs actually match the pattern?
      try {
        const regex = new RegExp(payload.pattern, payload.pattern_flags || '');
        for (const input of (payload.test_inputs || [])) {
          if (!regex.test(input)) {
            errors.push(`Test input "${input}" does NOT match the proposed pattern`);
          }
        }
        for (const nonMatch of (payload.test_non_matches || [])) {
          if (regex.test(nonMatch)) {
            errors.push(`Non-match input "${nonMatch}" DOES match the pattern — too broad`);
          }
        }
      } catch { /* already caught above */ }

      break;

    case 'workspace_context':
      checks.push('context_key_format', 'value_not_empty', 'no_conflicting_context',
                   'injection_point_valid');

      if (!payload.context_key || payload.context_key.length < 3) {
        errors.push('context_key must be at least 3 characters');
      }
      if (!payload.context_value || payload.context_value.length < 10) {
        errors.push('context_value must be at least 10 characters');
      }
      if (!['system_prompt', 'skill_context', 'both'].includes(payload.injection_point)) {
        errors.push(`Invalid injection_point: ${payload.injection_point}`);
      }

      // Check for conflicting context — does a context with the same key already exist?
      try {
        const existing = await loadExistingContext(workspaceId, payload.context_key);
        if (existing) {
          warnings.push(
            `Context key "${payload.context_key}" already exists with value: ` +
            `"${existing.substring(0, 100)}...". This change will overwrite it.`
          );
        }
      } catch (e) {
        warnings.push(`Could not check existing context: ${e.message}`);
      }

      break;

    case 'named_filter':
      checks.push('filter_name_unique', 'conditions_valid', 'entity_type_valid',
                   'fields_exist_in_schema');

      if (!payload.filter_name || payload.filter_name.length < 2) {
        errors.push('filter_name is required');
      }
      if (!payload.filter_definition?.conditions?.length) {
        errors.push('Filter must have at least one condition');
      }
      if (!['deal', 'contact', 'account'].includes(payload.filter_definition?.entity_type)) {
        errors.push(`Invalid entity_type: ${payload.filter_definition?.entity_type}`);
      }

      // Validate that referenced fields exist in the schema
      for (const condition of (payload.filter_definition?.conditions || [])) {
        const fieldExists = await checkFieldExists(
          payload.filter_definition.entity_type,
          condition.field
        );
        if (!fieldExists) {
          errors.push(`Field "${condition.field}" does not exist on ${payload.filter_definition.entity_type}`);
        }
      }

      break;

    case 'skill_definition':
      checks.push('three_phase_pattern', 'compute_before_classify', 'classify_before_synthesize',
                   'no_raw_data_to_claude', 'token_budget', 'output_schema_valid');

      const steps = payload.steps || [];
      const phases = steps.map((s: any) => s.phase);

      // Must follow three-phase pattern
      if (!phases.includes('compute')) {
        errors.push('Skill must have at least one COMPUTE step');
      }
      if (!phases.includes('synthesize')) {
        errors.push('Skill must have at least one SYNTHESIZE step');
      }

      // Compute must come before classify/synthesize
      const firstClassify = phases.indexOf('classify');
      const firstSynthesize = phases.indexOf('synthesize');
      const lastCompute = phases.lastIndexOf('compute');
      if (firstClassify !== -1 && firstClassify < phases.indexOf('compute')) {
        errors.push('CLASSIFY step cannot appear before any COMPUTE step');
      }
      if (firstSynthesize !== -1 && firstSynthesize <= lastCompute) {
        errors.push('SYNTHESIZE step must appear after all COMPUTE steps');
      }

      // Claude (synthesize) should never be step 1
      if (phases[0] === 'synthesize') {
        errors.push('SYNTHESIZE (Claude) cannot be the first step — compute must prepare data first');
      }

      break;
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    checks_performed: checks,
  };
}
```

---

## Task 3: Review Agent

**Question it answers:** "Is this change good enough to ship?"

**File:** `server/governance/review-agent.ts`

The review agent is an LLM that evaluates the *quality and appropriateness* of a proposed change, given the workspace context. Unlike the shape validator (structural checks), the review agent uses judgment.

```typescript
interface ReviewResult {
  recommendation: 'approve' | 'reject' | 'needs_revision';
  score: number;                  // 0-1 quality score
  concerns: string[];             // Specific issues
  strengths: string[];            // What's good about this change
  revision_suggestions?: string;  // If needs_revision, what to change
}

export async function reviewProposedChange(
  workspaceId: string,
  governanceRecord: SkillGovernanceRecord
): Promise<ReviewResult> {
  // Load workspace context for the reviewer
  const config = await configLoader.getConfig(workspaceId);
  const recentFeedback = await getRecentFeedback(workspaceId, 30);
  const existingResolvers = await loadExistingResolvers(workspaceId);
  const existingFilters = await loadExistingFilters(workspaceId);

  const prompt = `You are a RevOps platform quality reviewer. A self-healing system has proposed a change to Pandora, a RevOps intelligence assistant. Your job is to evaluate whether this change should be deployed.

## Workspace Context
- Team size: ${config.teams?.reps?.length || 'unknown'} reps
- CRM: ${config.crm_type || 'unknown'}
- Pipelines: ${config.pipelines?.map((p: any) => p.name).join(', ') || 'unknown'}

## Proposed Change
Type: ${governanceRecord.change_type}
Description: ${governanceRecord.change_description}

Payload:
${JSON.stringify(governanceRecord.change_payload, null, 2)}

## Shape Validation (already passed)
${governanceRecord.shape_errors?.length ? 'WARNINGS: ' + governanceRecord.shape_errors.join('; ') : 'Clean — no errors or warnings'}

## Source Feedback (what triggered this)
${governanceRecord.source_feedback_ids?.length || 0} feedback signals contributed to this proposal.

## Existing System State
- Existing resolver patterns: ${existingResolvers.length}
- Existing named filters: ${existingFilters.length}
- Recent feedback: ${recentFeedback.thumbsDown} thumbs down, ${recentFeedback.repeats} repeated questions in last 30 days

## Evaluation Criteria

Score each dimension 0-1:
1. **Specificity** — Is this change targeted enough, or too broad? A pattern matching "deals" is too broad. A pattern matching "Sara's enterprise deals closing this quarter" is targeted.
2. **Evidence strength** — Is there enough feedback to justify this change? 1 thumbs-down is weak. 5 repeated questions about the same topic is strong.
3. **Risk** — Could this change make things worse? Overwriting correct context is high risk. Adding a new named filter is low risk.
4. **Clarity** — Is the implementation specific enough to deploy without ambiguity?
5. **Reversibility** — Can this be easily undone? Context additions are reversible. Skill definitions are harder.

Respond with JSON only (no markdown, no backticks):
{
  "recommendation": "approve | reject | needs_revision",
  "score": 0.0-1.0,
  "concerns": ["specific concern 1", "..."],
  "strengths": ["specific strength 1", "..."],
  "revision_suggestions": "If needs_revision, describe what should change",
  "dimension_scores": {
    "specificity": 0.0-1.0,
    "evidence_strength": 0.0-1.0,
    "risk": 0.0-1.0,
    "clarity": 0.0-1.0,
    "reversibility": 0.0-1.0
  }
}`;

  const response = await llmCall({
    workspaceId,
    capability: 'reason',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1500,
  });

  return parseReviewResponse(response);
}
```

---

## Task 4: Explainer Agent

**Question it answers:** "What does this change do, in words a VP Sales would understand?"

**File:** `server/governance/explainer-agent.ts`

This is the most important governance agent for trust. It produces three levels of explanation, all in human language — no jargon, no code, no internal system references.

```typescript
interface Explanation {
  summary: string;          // One sentence. "Pandora will learn that Sara is an SDR, not an AE."
  detail: string;           // One paragraph. Full context of what changes and why.
  impact: string;           // One paragraph. What the admin should expect to be different.
  supersedes?: string;      // If replacing something: "This replaces the current behavior where..."
  rollback_note: string;    // "If this doesn't work, you can undo it with one click in Settings → Changes."
}

export async function explainProposedChange(
  workspaceId: string,
  governanceRecord: SkillGovernanceRecord
): Promise<Explanation> {
  // If this supersedes an existing change, load what it replaces
  let supersededDescription = '';
  if (governanceRecord.supersedes_id) {
    const previous = await getGovernanceRecord(governanceRecord.supersedes_id);
    supersededDescription = previous?.explanation_summary || 
      `an existing ${previous?.change_type || 'configuration'}`;
  }

  const prompt = `You are explaining a system change to a non-technical RevOps leader or VP of Sales. They need to understand:
1. What is changing (in plain English)
2. Why it's changing (what problem it fixes)
3. What will be different after (concrete examples)

## Change Details
Type: ${governanceRecord.change_type}
Technical description: ${governanceRecord.change_description}

## Change payload (for your understanding — do NOT reference internal field names):
${JSON.stringify(governanceRecord.change_payload, null, 2)}

${supersededDescription ? `## What This Replaces\nThis change will supersede: ${supersededDescription}` : '## New Addition\nThis is a net-new capability, not replacing anything existing.'}

## Source
This change was proposed because: ${governanceRecord.source_feedback_ids?.length || 0} users gave negative feedback or repeated questions that suggest the current behavior is inadequate.

Write your explanation for someone who has NEVER seen code, does not know what "resolver patterns" or "context injection" are, and cares about one thing: "will my team's RevOps assistant get smarter?"

Respond with JSON only:
{
  "summary": "One sentence, starts with 'Pandora will...'",
  "detail": "One paragraph explaining what changes and why, using concrete examples",
  "impact": "One paragraph explaining what the admin should expect to be different day-to-day",
  "supersedes": "If replacing something: 'This replaces the current behavior where...' or null if new",
  "rollback_note": "A reassuring note that this can be undone"
}`;

  const response = await llmCall({
    workspaceId,
    capability: 'reason',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1000,
  });

  return parseExplanation(response);
}
```

---

## Task 5: Rollback Engine

**Question it answers:** "Can we undo this instantly?"

**File:** `server/governance/rollback-engine.ts`

Every deployed change must be rollback-able with a single API call. The governance record's `supersedes_snapshot` contains a frozen copy of what existed before the change. Rollback restores that snapshot.

```typescript
export async function rollbackChange(
  workspaceId: string,
  governanceId: string,
  rolledBackBy: string,
  reason: string
): Promise<{ success: boolean; restored: string; error?: string }> {
  const record = await getGovernanceRecord(governanceId);

  if (!record || record.workspace_id !== workspaceId) {
    return { success: false, restored: '', error: 'Governance record not found' };
  }
  if (record.status !== 'deployed' && record.status !== 'monitoring') {
    return { success: false, restored: '', error: `Cannot rollback — status is "${record.status}"` };
  }

  try {
    switch (record.change_type) {
      case 'resolver_pattern':
        // Remove the deployed resolver from the router
        await removeResolver(workspaceId, record.change_payload.intent);
        // If it superseded a previous resolver, restore that one
        if (record.supersedes_snapshot) {
          await registerResolver(workspaceId, record.supersedes_snapshot);
        }
        break;

      case 'workspace_context':
        // Remove the context addition
        await removeContext(workspaceId, record.change_payload.context_key);
        // If it overwrote existing context, restore the previous value
        if (record.supersedes_snapshot) {
          await setContext(workspaceId, record.supersedes_snapshot.key, record.supersedes_snapshot.value);
        }
        // Clear config cache so skills pick up the revert
        configLoader.clearCache(workspaceId);
        break;

      case 'named_filter':
        // Remove the filter
        await removeNamedFilter(workspaceId, record.change_payload.filter_slug);
        // Restore previous if superseded
        if (record.supersedes_snapshot) {
          await registerNamedFilter(workspaceId, record.supersedes_snapshot);
        }
        break;

      case 'skill_definition':
        // Unregister the skill
        await unregisterSkill(workspaceId, record.change_payload.skill_id);
        // Restore previous version if superseded
        if (record.supersedes_snapshot) {
          await registerSkill(workspaceId, record.supersedes_snapshot);
        }
        break;

      default:
        return { success: false, restored: '', error: `Unknown change_type: ${record.change_type}` };
    }

    // Update governance record
    await query(
      `UPDATE skill_governance SET
         status = 'rolled_back',
         rolled_back_at = NOW(),
         rolled_back_by = $2,
         rollback_reason = $3,
         status_history = status_history || $4::jsonb,
         updated_at = NOW()
       WHERE id = $1`,
      [
        governanceId,
        rolledBackBy,
        reason,
        JSON.stringify([{
          status: 'rolled_back',
          timestamp: new Date().toISOString(),
          actor: rolledBackBy,
          reason,
        }]),
      ]
    );

    return {
      success: true,
      restored: record.supersedes_snapshot
        ? `Restored previous ${record.change_type}`
        : `Removed ${record.change_type} (no previous version to restore)`,
    };
  } catch (error) {
    console.error(`[Governance] Rollback failed for ${governanceId}:`, error);
    return { success: false, restored: '', error: String(error) };
  }
}

// Auto-rollback: called by the monitoring cron when feedback degrades
export async function checkForAutoRollback(workspaceId: string): Promise<void> {
  // Find deployed changes in monitoring period (first 7 days)
  const monitoring = await query(
    `SELECT * FROM skill_governance
     WHERE workspace_id = $1 AND status = 'monitoring'
       AND deployed_at > NOW() - INTERVAL '7 days'`,
    [workspaceId]
  );

  for (const record of monitoring.rows) {
    // Compare feedback before and after deployment
    const feedbackBefore = await countFeedback(workspaceId, {
      after: new Date(record.deployed_at.getTime() - 7 * 86400000),
      before: record.deployed_at,
    });
    const feedbackAfter = await countFeedback(workspaceId, {
      after: record.deployed_at,
      before: new Date(),
    });

    // If thumbs-down rate increased by >50%, auto-rollback
    const beforeRate = feedbackBefore.thumbsDown / Math.max(feedbackBefore.total, 1);
    const afterRate = feedbackAfter.thumbsDown / Math.max(feedbackAfter.total, 1);

    if (afterRate > beforeRate * 1.5 && feedbackAfter.total >= 5) {
      console.log(`[Governance] Auto-rolling back ${record.id}: feedback degraded`);
      await rollbackChange(
        workspaceId,
        record.id,
        'auto_rollback',
        `Feedback degraded: thumbs-down rate went from ${(beforeRate * 100).toFixed(0)}% to ${(afterRate * 100).toFixed(0)}%`
      );
    }

    // If trial period expired and feedback is stable or improved, mark as stable
    if (record.trial_expires_at && new Date() > record.trial_expires_at) {
      if (afterRate <= beforeRate * 1.1) {
        await query(
          `UPDATE skill_governance SET status = 'stable', updated_at = NOW() WHERE id = $1`,
          [record.id]
        );
      }
    }
  }
}
```

---

## Task 6: Comparison Engine

**Question it answers:** "Prove this is better than what we have."

**File:** `server/governance/comparison-engine.ts`

Before any change deploys, the comparison engine runs the same test inputs through both the current system and the proposed change, then scores the difference.

```typescript
interface ComparisonResult {
  test_cases: ComparisonTestCase[];
  overall_improvement: number;    // -1 to 1
  recommendation: 'deploy' | 'hold' | 'reject';
  summary: string;                // "3 of 5 test cases improved, 1 unchanged, 1 ambiguous"
}

interface ComparisonTestCase {
  input: string;                  // The test question or trigger
  before: {
    response: string;             // What the system currently answers
    source: string;               // Which path handled it: 'resolver', 'llm', 'skill'
    latency_ms?: number;
  };
  after: {
    response: string;             // What the system would answer with the change
    source: string;
    latency_ms?: number;
  };
  verdict: 'improved' | 'unchanged' | 'degraded' | 'ambiguous';
  verdict_reason: string;
}

export async function compareBeforeAfter(
  workspaceId: string,
  governanceRecord: SkillGovernanceRecord
): Promise<ComparisonResult> {
  // Build test cases from the feedback that triggered this change
  const testCases = await buildTestCases(workspaceId, governanceRecord);

  const results: ComparisonTestCase[] = [];

  for (const testCase of testCases) {
    // Run BEFORE: current system
    const beforeResult = await simulateCurrentSystem(workspaceId, testCase.input);

    // Run AFTER: system with proposed change applied (in sandbox)
    const afterResult = await simulateWithChange(workspaceId, testCase.input, governanceRecord);

    // Judge the difference
    const verdict = await judgeImprovement(testCase.input, beforeResult, afterResult);

    results.push({
      input: testCase.input,
      before: beforeResult,
      after: afterResult,
      ...verdict,
    });
  }

  const improved = results.filter(r => r.verdict === 'improved').length;
  const degraded = results.filter(r => r.verdict === 'degraded').length;
  const total = results.length;

  const overallImprovement = (improved - degraded) / Math.max(total, 1);

  return {
    test_cases: results,
    overall_improvement: overallImprovement,
    recommendation: degraded > 0 ? 'hold' : improved > total / 2 ? 'deploy' : 'hold',
    summary: `${improved} of ${total} test cases improved, ` +
             `${results.filter(r => r.verdict === 'unchanged').length} unchanged, ` +
             `${degraded} degraded, ` +
             `${results.filter(r => r.verdict === 'ambiguous').length} ambiguous`,
  };
}

async function buildTestCases(
  workspaceId: string,
  record: SkillGovernanceRecord
): Promise<Array<{ input: string }>> {
  const cases: Array<{ input: string }> = [];

  // Pull test inputs from the change payload itself
  if (record.change_payload.test_inputs) {
    for (const input of record.change_payload.test_inputs) {
      cases.push({ input });
    }
  }

  // Pull the original questions from the feedback that triggered this
  if (record.source_feedback_ids?.length) {
    const feedback = await query(
      `SELECT metadata FROM agent_feedback WHERE id = ANY($1)`,
      [record.source_feedback_ids]
    );
    for (const row of feedback.rows) {
      if (row.metadata?.original_question) {
        cases.push({ input: row.metadata.original_question });
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return cases.filter(c => {
    const key = c.input.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10); // Max 10 test cases
}

async function judgeImprovement(
  input: string,
  before: { response: string },
  after: { response: string }
): Promise<{ verdict: string; verdict_reason: string }> {
  // Use LLM to judge which response is better for the given question
  const prompt = `Compare these two responses to the same RevOps question.

Question: "${input}"

Response A (CURRENT):
${before.response.substring(0, 500)}

Response B (PROPOSED):
${after.response.substring(0, 500)}

Which response better answers the question? Consider:
- Accuracy of data/claims
- Specificity (concrete numbers vs vague statements)
- Actionability (does it tell the user what to DO?)
- Directness (does it answer the actual question asked?)

Respond with JSON only:
{
  "verdict": "A_better | B_better | tie | unclear",
  "reason": "One sentence explaining why"
}`;

  const result = await llmCall({
    capability: 'classify',  // Use cheaper model for judging
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 200,
  });

  const parsed = JSON.parse(result.replace(/```json\n?/g, '').replace(/```/g, '').trim());
  
  const verdictMap: Record<string, string> = {
    'A_better': 'degraded',
    'B_better': 'improved',
    'tie': 'unchanged',
    'unclear': 'ambiguous',
  };

  return {
    verdict: verdictMap[parsed.verdict] || 'ambiguous',
    verdict_reason: parsed.reason,
  };
}
```

---

## Task 7: Governance Pipeline Orchestrator

**File:** `server/governance/pipeline.ts`

This orchestrates the full governance flow: validate → review → explain → compare → present to admin.

```typescript
export async function processGovernanceProposal(
  workspaceId: string,
  proposal: {
    source_type: string;
    source_id?: string;
    source_feedback_ids?: string[];
    change_type: string;
    change_description: string;
    change_payload: any;
    supersedes_id?: string;
  }
): Promise<SkillGovernanceRecord> {

  // 1. Create the governance record
  const record = await createGovernanceRecord(workspaceId, proposal);
  await updateStatus(record.id, 'validating', 'system');

  // 2. Snapshot what this supersedes (for rollback)
  if (proposal.supersedes_id) {
    const snapshot = await snapshotExisting(workspaceId, proposal.change_type, proposal.supersedes_id);
    await updateSnapshot(record.id, snapshot);
  }

  // 3. Shape validation
  const shapeResult = await validateChangeShape(workspaceId, proposal.change_type, proposal.change_payload);
  await updateShapeValidation(record.id, shapeResult);

  if (!shapeResult.valid) {
    await updateStatus(record.id, 'rejected', 'shape_validator', 
      `Shape validation failed: ${shapeResult.errors.join('; ')}`);
    return getGovernanceRecord(record.id);
  }
  await updateStatus(record.id, 'validated', 'shape_validator');

  // 4. Review agent
  await updateStatus(record.id, 'reviewing', 'system');
  const reviewResult = await reviewProposedChange(workspaceId, await getGovernanceRecord(record.id));
  await updateReview(record.id, reviewResult);

  if (reviewResult.recommendation === 'reject') {
    await updateStatus(record.id, 'rejected', 'review_agent', 
      `Review rejected: ${reviewResult.concerns.join('; ')}`);
    return getGovernanceRecord(record.id);
  }
  await updateStatus(record.id, 'reviewed', 'review_agent');

  // 5. Explainer agent
  const explanation = await explainProposedChange(workspaceId, await getGovernanceRecord(record.id));
  await updateExplanation(record.id, explanation);

  // 6. Comparison engine
  const comparison = await compareBeforeAfter(workspaceId, await getGovernanceRecord(record.id));
  await updateComparison(record.id, comparison);

  // 7. Set final status
  if (comparison.recommendation === 'reject' || comparison.overall_improvement < -0.2) {
    await updateStatus(record.id, 'rejected', 'comparison_engine',
      `Comparison showed regression: ${comparison.summary}`);
  } else {
    await updateStatus(record.id, 'pending_approval', 'system');
  }

  return getGovernanceRecord(record.id);
}
```

---

## Task 8: API Endpoints

**File:** `server/routes/governance.ts`

```typescript
// List governance records for workspace
GET /:workspaceId/governance
  Query params: ?status=pending_approval (default) | all | deployed | rolled_back
  Returns: governance records with explanations

// Get single governance record with full detail
GET /:workspaceId/governance/:governanceId
  Returns: full record including comparison results, explanation, review

// Approve a pending change
POST /:workspaceId/governance/:governanceId/approve
  Body: { approved_by: string }
  Action: Deploy the change, set trial_expires_at = NOW() + 7 days
  Returns: { deployed: true, trial_expires: ISO date }

// Reject a pending change
POST /:workspaceId/governance/:governanceId/reject
  Body: { rejected_by: string, reason: string }
  Action: Mark as rejected
  Returns: { rejected: true }

// Rollback a deployed change
POST /:workspaceId/governance/:governanceId/rollback
  Body: { rolled_back_by: string, reason: string }
  Action: Execute rollback, restore previous state
  Returns: { rolled_back: true, restored: string }

// Delete a governance record (only if not deployed)
DELETE /:workspaceId/governance/:governanceId
  Validates: status must be 'proposed', 'rejected', or 'rolled_back'
  Returns: { deleted: true }

// Re-run comparison for a pending change (in case data changed)
POST /:workspaceId/governance/:governanceId/recompare
  Returns: updated comparison results

// List deployment history (audit trail)
GET /:workspaceId/governance/history
  Returns: all records sorted by deployed_at DESC, including rollbacks
```

---

## Task 9: Wire Self-Heal → Governance

Update the T007 self-heal review endpoint to feed into the governance pipeline instead of just storing raw suggestions.

In `server/routes/agent-feedback.ts`, after generating suggestions:

```typescript
// After generating self-heal suggestions, run each through governance
for (const suggestion of suggestions) {
  try {
    await processGovernanceProposal(workspaceId, {
      source_type: 'self_heal',
      source_id: suggestion.id,
      source_feedback_ids: suggestion.source_feedback_ids || [],
      change_type: suggestion.type,  // 'resolver_pattern', 'workspace_context', 'named_filter'
      change_description: suggestion.description,
      change_payload: buildPayloadFromSuggestion(suggestion),
    });
  } catch (error) {
    console.error(`[Governance] Failed to process suggestion:`, error);
  }
}
```

This means every self-heal suggestion automatically goes through shape validation, review, explanation, and comparison BEFORE any admin ever sees it.

---

## Task 10: Monitoring Cron

Add a daily cron job that checks deployed changes during their trial period:

```typescript
// In the daily cron scheduler:
async function runGovernanceMonitoring(): Promise<void> {
  const workspaces = await getAllActiveWorkspaces();
  
  for (const ws of workspaces) {
    await checkForAutoRollback(ws.id);
  }
}
```

This ensures that if a deployed change makes things worse, Pandora automatically rolls it back — the system is self-correcting in both directions.

---

## What This Does NOT Change

- The existing chat orchestrator or heuristic router
- The existing skill execution pipeline
- The workspace config schema or loader
- The feedback capture (T005/T006) or self-heal review (T007)
- The agent runtime or seed data

---

## Summary of New Files

| File | Purpose |
|---|---|
| `server/db/migrations/XXX_skill_governance.sql` | Governance records table |
| `server/governance/shape-validator.ts` | Structural validation of proposed changes |
| `server/governance/review-agent.ts` | LLM quality review of proposals |
| `server/governance/explainer-agent.ts` | Human-language explanation generator |
| `server/governance/rollback-engine.ts` | Instant rollback + auto-rollback monitor |
| `server/governance/comparison-engine.ts` | Before/after comparison with test cases |
| `server/governance/pipeline.ts` | Orchestrates the full governance flow |
| `server/routes/governance.ts` | API endpoints for admin interaction |

## The Admin Experience

```
Admin opens Settings → Autonomous Changes

Card 1 (pending_approval):
┌──────────────────────────────────────────────────────────────┐
│ 🔄 Proposed: Named filter for "Sara's deals"                │
│                                                              │
│ Pandora will learn to quickly pull Sara's pipeline whenever  │
│ someone asks about "Sara's deals" or "Sara's pipeline."      │
│ Currently this requires a full database scan each time.      │
│                                                              │
│ Why: 4 users asked about Sara's deals in the last 2 weeks.  │
│ 3 times the question was repeated — suggesting the first    │
│ answer wasn't satisfactory.                                  │
│                                                              │
│ Before: "Let me look that up..." → 3-second LLM analysis   │
│ After:  Instant response with Sara's 12 open deals ($2.1M)  │
│                                                              │
│ Review score: 0.82 | Comparison: 4/5 test cases improved    │
│                                                              │
│ [Approve]  [Reject]  [View Details]                         │
└──────────────────────────────────────────────────────────────┘

Card 2 (deployed, monitoring):
┌──────────────────────────────────────────────────────────────┐
│ ✅ Deployed 3 days ago: Workspace context addition           │
│                                                              │
│ Pandora learned that your team uses "commit" to mean deals  │
│ with >80% probability, not just forecast category = commit.  │
│                                                              │
│ Trial period: 4 days remaining                              │
│ Feedback since deploy: 2 thumbs up, 0 thumbs down           │
│                                                              │
│ [Rollback]  [View History]                                   │
└──────────────────────────────────────────────────────────────┘
```
