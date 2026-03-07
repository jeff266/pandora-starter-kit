# Pandora Build Prompt — Fine-Tuning Pipeline + LLM Router Integration
## Training Pairs → Custom Model → Router Upgrade

**Status:** Ready to build  
**Depends on:** F1–F6 (document feedback + training pairs), Session 12 LLM Router (llm_configs table, capability routing, llmRouter.call()), T019 (workspace memory)  
**Goal:** Close the loop between the `training_pairs` table and the LLM router so that accumulated document corrections progressively replace expensive Claude calls with a fine-tuned model hosted on Fireworks AI — without ever degrading quality.

---

## Before Starting

Read these files before writing any code:

1. `server/llm/router.ts` (or equivalent) — existing capability router, `llmRouter.call()`, provider normalization
2. `server/db/migrations/003_llm_config.sql` — `llm_configs` table: providers, routing, token budgets
3. `training_pairs` table schema (from F1) — system_prompt_at_time, raw_output, corrected_output, quality_label, template_type, section_id
4. `document_edits` table schema (from F2) — edit_distance, derived_style_signals
5. `server/config/workspace-config-loader.ts` — how workspace config and document profile are accessed
6. `server/types/document-profile.ts` (F1) — WorkspaceDocumentProfile, trainingPairsCount, fineTuningReadyAt
7. `server/documents/synthesizer.ts` (T012 + F3) — where `generate` capability calls happen for document synthesis
8. `server/agents/orchestrator.ts` — where `classify` and `reason` capability calls happen for chat routing
9. Fireworks AI API docs — fine-tuning job submission, model deployment, inference endpoint format
10. `server/routes/training.ts` (F6) — existing training pair export endpoint

**Do not proceed until you have read all ten.**

---

## Architecture Overview

The training pairs table collects two distinct types of examples that train two distinct models:

```
training_pairs
  ├── template_type IS NOT NULL, section_id IS NOT NULL
  │     → Document synthesis pairs
  │     → Train: pandora-docsynth model
  │     → Replaces: anthropic/claude (generate capability)
  │
  └── template_type IS NULL, section_id IS NULL  
        → Classification / routing pairs (added in this prompt)
        → Train: pandora-classifier model  
        → Replaces: fireworks/deepseek-v3 (classify capability)

Router upgrade path:
  routing.generate → fireworks/pandora-docsynth-v1
  routing.classify → fireworks/pandora-classifier-v1
  
  Both with confidence gates: if model.confidence < 0.75, fallback to base model
```

The workspace document quality score (F6) is the real-world benchmark — it measures what actually changes before documents go to real CROs, which is more meaningful than any held-out test set.

---

## Task List

---

### FT1 — Training Pair Segmentation + Quality Labeling

**Files:** Update `server/documents/edit-capture.ts` (F2), update `training_pairs` table migration

The `training_pairs` table needs two additions to support model training properly:

**Addition 1 — Pair type column:**

```sql
ALTER TABLE training_pairs ADD COLUMN pair_type TEXT NOT NULL DEFAULT 'document_synthesis';
-- 'document_synthesis': narrative text pairs (exec summary, risk section, etc.)
-- 'classification': routing/judgment pairs (added in FT2)
-- 'chart_annotation': chart annotation pairs (when annotations get edited)
```

**Addition 2 — Quality label auto-derivation:**

Quality labels are currently stored but not automatically computed. Add a trigger that derives the label after each pair is inserted:

```typescript
// server/documents/edit-capture.ts — update captureDocumentEdit()

function deriveQualityLabel(
  editDistance: number,
  wasDistributed: boolean,
  recommendationsActioned: number
): 'good' | 'needs_improvement' | 'poor' {
  // Good: low edit distance (model got it mostly right) AND document was sent
  if (editDistance < 0.15 && wasDistributed) return 'good';
  
  // Good: recommendations were actioned (document drove action, even if edited)
  if (recommendationsActioned >= 2 && wasDistributed) return 'good';
  
  // Poor: heavily edited OR never distributed
  if (editDistance > 0.5) return 'poor';
  if (!wasDistributed) return 'poor';
  
  // Everything else: needs_improvement
  return 'needs_improvement';
}
```

Note: `wasDistributed` and `recommendationsActioned` are updated after-the-fact by F4 (implicit signal capture). The quality label should be recalculated when those fields update, not just at insert time. Add an update trigger or a scheduled recalculation job that runs nightly.

**Nightly quality label recalculation:**

```typescript
// server/jobs/recalculate-training-quality.ts

async function recalculateTrainingPairQuality(workspaceId: string): Promise<void> {
  await db.query(`
    UPDATE training_pairs
    SET quality_label = CASE
      WHEN edit_distance < 0.15 AND was_distributed = TRUE THEN 'good'
      WHEN recommendations_actioned >= 2 AND was_distributed = TRUE THEN 'good'
      WHEN edit_distance > 0.5 THEN 'poor'
      WHEN was_distributed = FALSE THEN 'poor'
      ELSE 'needs_improvement'
    END
    WHERE workspace_id = $1
      AND created_at > NOW() - INTERVAL '90 days'
  `, [workspaceId]);
}
```

**Acceptance:** `training_pairs` table has `pair_type` column. Quality labels are recalculated nightly. After marking a document as distributed (F4), the quality label updates from `poor` to `good` or `needs_improvement` on next recalculation run.

---

### FT2 — Classification Training Pair Capture

**Files:** `server/llm/training-capture.ts` (new), update `server/agents/orchestrator.ts`

Document synthesis pairs are captured at edit time (F2). Classification pairs require a different capture mechanism — they're implicit in whether the router's decision produced a good or bad outcome.

**Classification pair shape:**

```typescript
interface ClassificationTrainingPair {
  pair_type: 'classification';
  
  // The input
  system_prompt_at_time: string;      // classification system prompt
  raw_output: string;                 // what the classifier decided
  // e.g. '{"question_type": "analytical", "visualization_hint": "bar", "requires_live_data": false}'
  
  // The correction (when it exists)
  corrected_output: string;           // what the correct decision should have been
  // e.g. '{"question_type": "strategic", "visualization_hint": null, "requires_live_data": true}'
  
  // How we know it was wrong
  correction_signal: 'contradiction_handler' | 'user_explicit' | 'strategic_routing_miss' | 'chart_type_wrong';
  
  quality_label: 'good' | 'needs_improvement' | 'poor';
}
```

**Capture triggers:**

**Trigger 1 — Contradiction handler fires (T7):** When the user says "that's not right" and the system re-queries, the original classification was wrong. Capture the original routing decision as a `poor` classification pair, and the corrected routing as the `corrected_output`.

```typescript
// In server/agents/orchestrator.ts — contradiction handler path

async function captureContradictionClassificationPair(
  workspaceId: string,
  originalClassification: RouterClassification,
  correctedClassification: RouterClassification,
  systemPromptUsed: string
): Promise<void> {
  await db.query(`
    INSERT INTO training_pairs
      (workspace_id, pair_type, system_prompt_at_time, raw_output, corrected_output,
       edit_distance, quality_label, correction_signal)
    VALUES ($1, 'classification', $2, $3, $4, 1.0, 'poor', 'contradiction_handler')
  `, [
    workspaceId,
    systemPromptUsed,
    JSON.stringify(originalClassification),
    JSON.stringify(correctedClassification)
  ]);
}
```

**Trigger 2 — Correct classifications (positive examples):** When a classification leads to a response that gets no pushback, gets distributed, or produces actioned recommendations — capture it as a `good` pair. This gives the fine-tuned classifier positive examples, not just corrections.

```typescript
// After each successful response that gets no contradiction within the next 2 turns:

async function captureSuccessfulClassificationPair(
  workspaceId: string,
  classification: RouterClassification,
  systemPromptUsed: string
): Promise<void> {
  await db.query(`
    INSERT INTO training_pairs
      (workspace_id, pair_type, system_prompt_at_time, raw_output, corrected_output,
       edit_distance, quality_label, correction_signal)
    VALUES ($1, 'classification', $2, $3, $3, 0.0, 'good', null)
  `, [
    workspaceId,
    systemPromptUsed,
    JSON.stringify(classification)
    // corrected_output = raw_output (no correction needed)
  ]);
}
```

**Trigger 3 — Strategic routing miss:** When a user asks a strategic question ("why do we keep...") but the router classifies it as analytical and returns a data response, then the user rephrases or explicitly asks for strategy — capture the miss.

The session context (T010) already tracks conversation turns. Add detection: if turn N is classified `analytical` and turn N+1 contains "that's not what I asked" or "I meant strategically" or "why is this happening" — the turn N classification was likely wrong.

**Acceptance:** `training_pairs` table accumulates `pair_type: 'classification'` rows. After a contradiction handler fires, a `poor` classification pair is written. After 5 successful exchanges, 5 `good` classification pairs exist. The nightly quality recalculation runs on classification pairs the same as document pairs.

---

### FT3 — Training Dataset Assembler

**Files:** `server/llm/dataset-assembler.ts` (new)

The dataset assembler transforms raw `training_pairs` rows into the JSONL format Fireworks AI expects for fine-tuning. It handles deduplication, quality filtering, format validation, and train/validation split.

```typescript
// server/llm/dataset-assembler.ts

export interface FireworksFineTuneRecord {
  messages: {
    role: 'system' | 'user' | 'assistant';
    content: string;
  }[];
}

export interface DatasetAssemblyOptions {
  pairType: 'document_synthesis' | 'classification';
  qualityFilter: ('good' | 'needs_improvement')[];   // never include 'poor' in training
  minEditDistance?: number;                           // filter out near-identical pairs
  maxEditDistance?: number;                           // filter out near-total rewrites
  workspaceIds?: string[];                            // null = all workspaces
  trainSplitPct: number;                             // default 0.9 (90% train, 10% val)
  deduplicateThreshold: number;                       // 0.95 similarity = deduplicate
}

export async function assembleDataset(
  options: DatasetAssemblyOptions
): Promise<{
  trainRecords: FireworksFineTuneRecord[];
  valRecords: FireworksFineTuneRecord[];
  stats: DatasetStats;
}> {
  
  const { pairType, qualityFilter, minEditDistance = 0.05, maxEditDistance = 0.9 } = options;
  
  // Pull qualifying pairs
  const pairs = await db.query(`
    SELECT 
      system_prompt_at_time,
      raw_output,
      corrected_output,
      quality_label,
      edit_distance,
      workspace_id,
      template_type,
      section_id
    FROM training_pairs
    WHERE pair_type = $1
      AND quality_label = ANY($2)
      AND edit_distance >= $3
      AND edit_distance <= $4
      ${options.workspaceIds ? 'AND workspace_id = ANY($5)' : ''}
    ORDER BY created_at DESC
  `, [pairType, qualityFilter, minEditDistance, maxEditDistance, options.workspaceIds].filter(Boolean));
  
  // Deduplicate
  const deduped = deduplicatePairs(pairs.rows, options.deduplicateThreshold);
  
  // Convert to Fireworks format
  const records = deduped.map(pair => convertToFineTuneFormat(pair, pairType));
  
  // Shuffle and split
  const shuffled = shuffle(records);
  const splitIdx = Math.floor(shuffled.length * options.trainSplitPct);
  
  return {
    trainRecords: shuffled.slice(0, splitIdx),
    valRecords: shuffled.slice(splitIdx),
    stats: {
      totalPairs: pairs.rows.length,
      afterDedup: deduped.length,
      trainCount: splitIdx,
      valCount: shuffled.length - splitIdx,
      byQuality: countByQuality(pairs.rows),
      byTemplate: countByTemplate(pairs.rows),
      bySection: countBySection(pairs.rows),
    }
  };
}

function convertToFineTuneFormat(
  pair: TrainingPairRow,
  pairType: string
): FireworksFineTuneRecord {
  
  if (pairType === 'document_synthesis') {
    // Format: system prompt + "Generate this section" user turn + corrected output as assistant
    return {
      messages: [
        { role: 'system', content: pair.system_prompt_at_time },
        { role: 'user', content: `Generate the ${pair.section_id} section for a ${pair.template_type}.` },
        { role: 'assistant', content: pair.corrected_output }
        // NOT raw_output — we train on the corrected (preferred) version
      ]
    };
  }
  
  if (pairType === 'classification') {
    // Format: classification system prompt + question + correct classification as assistant
    return {
      messages: [
        { role: 'system', content: pair.system_prompt_at_time },
        { role: 'user', content: extractUserMessageFromPrompt(pair.system_prompt_at_time) },
        { role: 'assistant', content: pair.corrected_output }
      ]
    };
  }
  
  throw new Error(`Unknown pair_type: ${pairType}`);
}

function deduplicatePairs(pairs: TrainingPairRow[], threshold: number): TrainingPairRow[] {
  // Simple dedup: if two pairs have identical system prompts (normalized), keep the one
  // with higher quality label or lower edit distance
  const seen = new Map<string, TrainingPairRow>();
  
  for (const pair of pairs) {
    const key = normalizePrompt(pair.system_prompt_at_time).slice(0, 200); // first 200 chars as key
    const existing = seen.get(key);
    
    if (!existing) {
      seen.set(key, pair);
    } else {
      // Keep the better one
      const currentScore = qualityScore(pair);
      const existingScore = qualityScore(existing);
      if (currentScore > existingScore) seen.set(key, pair);
    }
  }
  
  return Array.from(seen.values());
}

function qualityScore(pair: TrainingPairRow): number {
  const labelScore = { good: 3, needs_improvement: 2, poor: 1 }[pair.quality_label] || 0;
  // Lower edit distance = better first draft = less correction needed = lower training value
  // BUT quality_label already accounts for this, so use label as primary signal
  return labelScore;
}
```

**Acceptance:** `assembleDataset({ pairType: 'document_synthesis', qualityFilter: ['good', 'needs_improvement'], trainSplitPct: 0.9, deduplicateThreshold: 0.95 })` returns `trainRecords` and `valRecords` in valid Fireworks format. Stats accurately reflect pair counts. Poor-quality pairs are never included.

---

### FT4 — Fireworks Fine-Tuning Job Manager

**Files:** `server/llm/fireworks-trainer.ts` (new), new `fine_tuning_jobs` table

```sql
CREATE TABLE fine_tuning_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- What we're training
  model_purpose TEXT NOT NULL,    -- 'document_synthesis' | 'classification'
  pair_type TEXT NOT NULL,
  base_model TEXT NOT NULL,       -- e.g. 'accounts/fireworks/models/llama-v3p1-8b-instruct'
  
  -- Fireworks job details
  fireworks_job_id TEXT,          -- returned after submission
  fireworks_model_id TEXT,        -- returned after completion (the deployed model ID)
  
  -- Dataset
  train_record_count INT NOT NULL,
  val_record_count INT NOT NULL,
  dataset_s3_uri TEXT,            -- where the JSONL was uploaded
  
  -- Training params
  epochs INT NOT NULL DEFAULT 3,
  learning_rate FLOAT NOT NULL DEFAULT 0.0001,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'uploading_dataset' | 'submitted' | 'training' | 'completed' | 'failed' | 'deployed'
  
  -- Evaluation
  val_loss FLOAT,                 -- from Fireworks after training
  baseline_val_loss FLOAT,        -- val loss of base model on same set (for comparison)
  quality_improvement_pct FLOAT,  -- derived: improvement over baseline
  
  -- Deployment
  deployed_at TIMESTAMPTZ,
  deployment_endpoint TEXT,       -- the inference endpoint
  confidence_gate_threshold FLOAT DEFAULT 0.75,  -- below this → fallback to base model
  
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fine_tuning_jobs_status ON fine_tuning_jobs(status);
CREATE INDEX idx_fine_tuning_jobs_purpose ON fine_tuning_jobs(model_purpose, status);
```

```typescript
// server/llm/fireworks-trainer.ts

const FIREWORKS_BASE_MODELS = {
  document_synthesis: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
  // 8B is sufficient for document synthesis — it's pattern matching on good prose
  // Upgrade to 70B if quality is insufficient after evaluation
  
  classification: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
  // Classification is lightweight — 8B handles it well
};

export async function submitFineTuningJob(
  purpose: 'document_synthesis' | 'classification',
  dataset: { trainRecords: FireworksFineTuneRecord[]; valRecords: FireworksFineTuneRecord[] }
): Promise<string> {  // returns job ID
  
  // 1. Upload dataset to Fireworks (or S3 if Fireworks requires it)
  const datasetUri = await uploadDatasetToFireworks(dataset);
  
  // 2. Create job record
  const jobId = await createJobRecord(purpose, dataset, datasetUri);
  
  // 3. Submit to Fireworks fine-tuning API
  const fireworksJobId = await submitToFireworks({
    model: FIREWORKS_BASE_MODELS[purpose],
    dataset_uri: datasetUri,
    epochs: 3,
    learning_rate: 0.0001,
    display_name: `pandora-${purpose}-${new Date().toISOString().slice(0,10)}`
  });
  
  // 4. Update job record with Fireworks ID
  await db.query(
    `UPDATE fine_tuning_jobs SET fireworks_job_id = $1, status = 'submitted' WHERE id = $2`,
    [fireworksJobId, jobId]
  );
  
  // 5. Start polling for completion
  schedulePollJob(jobId, fireworksJobId);
  
  return jobId;
}

async function pollFineTuningJob(jobId: string, fireworksJobId: string): Promise<void> {
  // Poll every 5 minutes
  const interval = setInterval(async () => {
    try {
      const status = await getFireworksJobStatus(fireworksJobId);
      
      await db.query(
        `UPDATE fine_tuning_jobs SET status = $1 WHERE id = $2`,
        [status.state, jobId]
      );
      
      if (status.state === 'completed') {
        clearInterval(interval);
        await onJobCompleted(jobId, status);
      }
      
      if (status.state === 'failed') {
        clearInterval(interval);
        await db.query(
          `UPDATE fine_tuning_jobs SET failed_reason = $1 WHERE id = $2`,
          [status.error, jobId]
        );
      }
    } catch (err) {
      console.error('[FineTuning] Poll failed:', err);
    }
  }, 5 * 60 * 1000);
}

async function onJobCompleted(jobId: string, status: FireworksJobStatus): Promise<void> {
  // 1. Record val loss
  await db.query(
    `UPDATE fine_tuning_jobs 
     SET val_loss = $1, status = 'completed', completed_at = NOW()
     WHERE id = $2`,
    [status.val_loss, jobId]
  );
  
  // 2. Deploy the model
  const deploymentEndpoint = await deployFineTunedModel(status.model_id);
  
  // 3. Update job with deployment info
  await db.query(
    `UPDATE fine_tuning_jobs 
     SET fireworks_model_id = $1, deployment_endpoint = $2, 
         status = 'deployed', deployed_at = NOW()
     WHERE id = $3`,
    [status.model_id, deploymentEndpoint, jobId]
  );
  
  // 4. Evaluate quality improvement (FT5 handles the actual routing update)
  console.log(`[FineTuning] Job ${jobId} deployed at ${deploymentEndpoint}`);
}
```

**Acceptance:** `submitFineTuningJob('document_synthesis', dataset)` creates a `fine_tuning_jobs` record, submits to Fireworks, and begins polling. When Fireworks returns completion, the record updates with `status = 'deployed'` and `deployment_endpoint`. The job can be monitored via the `fine_tuning_jobs` table.

---

### FT5 — Confidence-Gated Router Upgrade

**Files:** `server/llm/router.ts` (update), `server/llm/model-evaluator.ts` (new)

This is the most important task — wiring the fine-tuned model into the router with a confidence gate so quality never degrades.

**Router update:**

```typescript
// server/llm/router.ts — update the capability resolution

async function resolveModel(
  workspaceId: string,
  capability: 'extract' | 'classify' | 'reason' | 'generate'
): Promise<ResolvedModel> {
  
  // 1. Check workspace routing override (BYOK path)
  const workspaceConfig = await getWorkspaceLlmConfig(workspaceId);
  if (workspaceConfig.routing[capability]) {
    return { modelId: workspaceConfig.routing[capability], source: 'workspace_override' };
  }
  
  // 2. Check for deployed fine-tuned model for this capability
  const fineTunedModel = await getDeployedFineTunedModel(capability);
  if (fineTunedModel) {
    return { 
      modelId: fineTunedModel.fireworks_model_id,
      endpoint: fineTunedModel.deployment_endpoint,
      confidenceGate: fineTunedModel.confidence_gate_threshold,
      fallbackModelId: PLATFORM_DEFAULTS[capability],
      source: 'fine_tuned'
    };
  }
  
  // 3. Platform default
  return { modelId: PLATFORM_DEFAULTS[capability], source: 'platform_default' };
}

const PLATFORM_DEFAULTS: Record<string, string> = {
  extract: 'accounts/fireworks/models/deepseek-v3',
  classify: 'accounts/fireworks/models/deepseek-v3',
  reason: 'anthropic/claude-sonnet-4-20250514',
  generate: 'anthropic/claude-sonnet-4-20250514',
};

// The confidence gate — called when using a fine-tuned model
async function callWithConfidenceGate(
  resolvedModel: ResolvedModel,
  messages: Message[],
  options: CallOptions
): Promise<NormalizedResponse> {
  
  if (!resolvedModel.confidenceGate) {
    // No gate — call directly
    return callProvider(resolvedModel.modelId, messages, options);
  }
  
  // Call fine-tuned model
  const response = await callProvider(resolvedModel.modelId, messages, {
    ...options,
    requestLogprobs: true  // needed for confidence estimation
  });
  
  // Estimate confidence from logprobs
  const confidence = estimateConfidence(response.logprobs);
  
  if (confidence >= resolvedModel.confidenceGate) {
    // Fine-tuned model is confident — use its response
    return { ...response, model_used: resolvedModel.modelId, confidence };
  }
  
  // Below threshold — fall back to base model
  console.log(`[Router] Fine-tuned model confidence ${confidence} below gate ${resolvedModel.confidenceGate} — falling back to ${resolvedModel.fallbackModelId}`);
  
  const fallbackResponse = await callProvider(resolvedModel.fallbackModelId, messages, options);
  return { ...fallbackResponse, model_used: resolvedModel.fallbackModelId, confidence: 1.0, fell_back: true };
}

function estimateConfidence(logprobs: TokenLogprob[] | null): number {
  if (!logprobs || logprobs.length === 0) return 0.5;  // unknown → conservative
  
  // Average of top-token probabilities across the response
  // High average probability = confident output
  const probs = logprobs.map(lp => Math.exp(lp.logprob));
  return probs.reduce((a, b) => a + b, 0) / probs.length;
}
```

**Model evaluator — before deploying any fine-tuned model:**

Before the router starts using a fine-tuned model, run an evaluation on the validation set to confirm it's actually better than the baseline:

```typescript
// server/llm/model-evaluator.ts

export async function evaluateFineTunedModel(
  jobId: string,
  valRecords: FireworksFineTuneRecord[]
): Promise<{
  approved: boolean;
  fineTunedScore: number;
  baselineScore: number;
  improvementPct: number;
  recommendation: string;
}> {
  const job = await getFineTuningJob(jobId);
  
  // Score fine-tuned model on validation set
  const fineTunedScore = await scoreModelOnValidationSet(
    job.fireworks_model_id, valRecords
  );
  
  // Score baseline model on same validation set
  const baselineScore = await scoreModelOnValidationSet(
    PLATFORM_DEFAULTS[job.model_purpose === 'document_synthesis' ? 'generate' : 'classify'],
    valRecords
  );
  
  const improvementPct = ((fineTunedScore - baselineScore) / baselineScore) * 100;
  
  // Approval threshold: fine-tuned must be >= 5% better than baseline
  const approved = improvementPct >= 5;
  
  // Update job record
  await db.query(
    `UPDATE fine_tuning_jobs 
     SET val_loss = $1, baseline_val_loss = $2, quality_improvement_pct = $3
     WHERE id = $4`,
    [fineTunedScore, baselineScore, improvementPct, jobId]
  );
  
  return {
    approved,
    fineTunedScore,
    baselineScore,
    improvementPct,
    recommendation: approved
      ? `Fine-tuned model shows ${improvementPct.toFixed(1)}% improvement. Safe to deploy.`
      : `Fine-tuned model only shows ${improvementPct.toFixed(1)}% improvement — below 5% threshold. Collect more training pairs before retrying.`
  };
}

async function scoreModelOnValidationSet(
  modelId: string,
  valRecords: FireworksFineTuneRecord[]
): Promise<number> {
  // Run model on each validation input, compare output to expected (corrected) output
  // Use ROUGE-L score for document synthesis (measures recall of n-grams)
  // Use exact match rate for classification (either right or wrong)
  
  let totalScore = 0;
  
  for (const record of valRecords.slice(0, 50)) {  // cap at 50 for cost
    const input = record.messages.slice(0, -1);  // all but last (assistant) message
    const expected = record.messages[record.messages.length - 1].content;
    
    const actual = await callProvider(modelId, input, { maxTokens: 500 });
    totalScore += computeSimilarityScore(actual.content, expected);
  }
  
  return totalScore / Math.min(valRecords.length, 50);
}
```

**Acceptance:** After a fine-tuning job completes and deploys, calling `llmRouter.call(workspaceId, 'generate', ...)` uses the fine-tuned model when confidence ≥ 0.75, and falls back to Claude when confidence < 0.75. The `model_used` and `confidence` fields are logged with every LLM call. A fine-tuned model that scores below 5% improvement vs. baseline is NOT deployed to the router.

---

### FT6 — Fine-Tuning Admin Dashboard

**Files:** `client/src/pages/admin/FineTuning.tsx` (new), API routes at `server/routes/fine-tuning.ts` (new)

**API routes:**

```
GET  /api/admin/fine-tuning/readiness
     Returns: {
       documentSynthesis: { 
         totalPairs: number, goodPairs: number, 
         readyToTrain: boolean, threshold: number,
         byWorkspace: { workspaceId, count }[]
       },
       classification: { ... same shape ... }
     }

POST /api/admin/fine-tuning/assemble-dataset
     Body: { pairType, qualityFilter, workspaceIds? }
     Returns: { trainCount, valCount, stats, downloadUrl }
     Auth: super-admin only

POST /api/admin/fine-tuning/submit-job
     Body: { pairType, datasetUrl, epochs, learningRate }
     Returns: { jobId }
     Auth: super-admin only

GET  /api/admin/fine-tuning/jobs
     Returns: fine_tuning_jobs[] ordered by created_at DESC

GET  /api/admin/fine-tuning/jobs/:id
     Returns: single job with full details + evaluation results

POST /api/admin/fine-tuning/jobs/:id/evaluate
     Triggers evaluation run on validation set
     Returns: { approved, fineTunedScore, baselineScore, improvementPct, recommendation }

POST /api/admin/fine-tuning/jobs/:id/deploy
     Deploys approved model to router (updates llm_configs default routing)
     Auth: super-admin only

POST /api/admin/fine-tuning/jobs/:id/rollback
     Removes model from router, reverts to base model
     Auth: super-admin only
```

**Admin UI page:**

```
Fine-Tuning Pipeline

─── Training Readiness ──────────────────────────────

Document Synthesis Model
  Total pairs: 312 / 500 target
  [█████████████████░░░] 62.4%
  Good quality: 218    Needs improvement: 94
  Ready to train: NO — collect 188 more good pairs

Classification Model  
  Total pairs: 87 / 200 target
  [████████░░░░░░░░░░░░] 43.5%
  Ready to train: NO — collect 113 more good pairs

─── Training Jobs ───────────────────────────────────

[+ New Training Job]

  pandora-docsynth-v1   ● Deployed    Improvement: +12.3%    Feb 14, 2026
    Base: llama-v3p1-8b · 312 train · 34 val · 3 epochs
    Confidence gate: 0.75 · Fallback rate: 8.2% (last 7 days)
    [Rollback] [View Details]

  pandora-docsynth-v0   ○ Superseded                          Jan 3, 2026
    Improvement: +6.1%
    [View Details]

─── Router Status ───────────────────────────────────

  generate  →  pandora-docsynth-v1  (fine-tuned)
               Fallback rate: 8.2% · Avg confidence: 0.84
  
  classify  →  fireworks/deepseek-v3  (platform default)
               No fine-tuned model deployed yet
  
  reason    →  anthropic/claude-sonnet-4-20250514  (platform default)
  extract   →  fireworks/deepseek-v3  (platform default)

─── Cost Impact ─────────────────────────────────────

  Last 30 days:
  Document synthesis calls routed to fine-tuned model: 1,847
  Estimated Claude calls avoided: 1,516  (82% hit rate)
  Estimated cost savings: $4.20  (at $0.00277/1K tokens)
  
  Training cost (one-time): ~$8.40
  Break-even: 61 days from deployment ✓
```

**Fallback rate tracking:** Every `llmRouter.call()` logs `model_used` and `fell_back` to a `llm_call_log` table. The fallback rate in the dashboard is derived from this log. A high fallback rate (>20%) on the fine-tuned model means the confidence gate is too conservative, or the model needs retraining on harder examples.

**Acceptance:** The fine-tuning admin page loads with accurate readiness percentages. "New Training Job" flow works: assemble dataset → confirm stats → submit to Fireworks → monitor status. After a job completes and passes evaluation, "Deploy" updates the router. The cost impact section shows accurate call counts and savings.

---

## Sequencing

```
FT1 (table updates + quality labeling) — first
  ↓
FT2 (classification pair capture) — depends on FT1 schema
FT3 (dataset assembler) — depends on FT1 data
  ↓ (FT2 and FT3 can run in parallel after FT1)
FT4 (Fireworks job manager) — depends on FT3 (needs assembled dataset)
  ↓
FT5 (confidence-gated router upgrade) — depends on FT4 (needs deployed model)
  ↓
FT6 (admin dashboard) — depends on FT4 + FT5 (reads job table + router status)
```

FT1 is a prerequisite. FT2 and FT3 can run in parallel. FT4 → FT5 → FT6 are sequential.

---

## Acceptance Criteria — Full Suite

1. **Training pairs are segmented by type.** `pair_type` column exists. Document synthesis pairs and classification pairs are distinct. Quality labels recalculate nightly.

2. **Classification pairs accumulate.** Trigger a contradiction (say "that's wrong" after a response). A `pair_type: 'classification'` row appears in `training_pairs` with `quality_label: 'poor'`. After 5 successful exchanges without contradiction, 5 `good` classification pairs exist.

3. **Dataset assembly works.** Call `assembleDataset({ pairType: 'document_synthesis', qualityFilter: ['good', 'needs_improvement'] })`. Returns valid `FireworksFineTuneRecord[]` in Fireworks JSONL format. Poor pairs are excluded. Train/val split is 90/10.

4. **Fine-tuning job submits.** `submitFineTuningJob('document_synthesis', dataset)` creates a `fine_tuning_jobs` record with `status: 'submitted'`. Fireworks job ID is stored. Status polling updates the record.

5. **Evaluation gates deployment.** A model that scores less than 5% better than baseline is marked `approved: false` and NOT added to the router. A model scoring 5%+ is marked approved and ready for deployment.

6. **Confidence gate works in production.** After deploying a fine-tuned model, `llmRouter.call(workspaceId, 'generate', ...)` returns responses from the fine-tuned model when confidence ≥ 0.75. It falls back to Claude when confidence < 0.75. The `model_used` and `confidence` fields are present in every response.

7. **Rollback works.** `POST /api/admin/fine-tuning/jobs/:id/rollback` removes the model from the router. Subsequent calls use the platform default. No downtime.

8. **Dashboard shows accurate metrics.** Training readiness bar reflects actual `training_pairs` counts. Fallback rate reflects actual `llm_call_log` data. Cost savings calculation is accurate within 10%.

9. **No quality regression.** After deploying the fine-tuned model, the workspace document quality score (F6) should not decrease. If it does, the confidence gate threshold is too low — raise it or trigger rollback.

10. **No regression on existing functionality.** All T010–T021, F1–F6, V1–V6 features continue to work. BYOK routing overrides still take priority over the fine-tuned model.
