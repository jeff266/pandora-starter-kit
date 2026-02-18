# Claude Code Delta: Monte Carlo Pipeline Filter + Pipeline Type Awareness

## What This Is

Two related changes to the existing `monte-carlo-forecast` skill:

1. **Pipeline scoping** — the simulation can run against a single pipeline rather than all deals in the workspace
2. **Pipeline type awareness** — Component B (projected pipeline generation) behaves differently depending on whether the pipeline is New Business, Renewal, or Expansion

These changes are related: you can't correctly model a Renewal pipeline with the same future pipeline logic as New Business. This delta fixes that.

**Scope:** Changes touch `monte-carlo-distributions.ts`, `monte-carlo-engine.ts`, `monte-carlo-forecast.ts` (skill definition), and `server/routes/skills.ts`. Do not touch `monte-carlo-variance.ts` except where noted below.

---

## Background: Why Component B Breaks for Renewals and Expansions

The current Component B logic samples from `pipelineCreationRates` — how many new deals reps create per month. This is correct for New Business where the prospect universe is unbounded.

It is wrong for:

- **Renewals** — the population is finite and known. Every renewal opportunity either already exists as a deal or will be created at a predictable date (contract end date). There is no open-ended pipeline creation rate. Component B should be near-zero; future renewal deals are loaded from the database, not simulated.
- **Expansions** — bounded by the existing customer base. The addressable pool is `current customer ARR × expected expansion rate`, not rep prospecting pace. You cannot expand a customer beyond what they have.

---

## Change 1: Add `pipeline_id` and `pipeline_type` as Skill Params

In `server/skills/library/monte-carlo-forecast.ts`:

```typescript
const pipelineId: string | null   = context.params?.pipelineId   ?? null;
const pipelineType: PipelineType  = context.params?.pipelineType ?? 'new_business';

type PipelineType = 'new_business' | 'renewal' | 'expansion';
```

Pass both values through to all compute steps.

**Auto-detection (optional enhancement):** If `pipelineType` is not passed explicitly, attempt to infer it from the pipeline name:

```typescript
function inferPipelineType(pipelineName: string): PipelineType {
  const name = pipelineName.toLowerCase();
  if (name.includes('renew') || name.includes('retention')) return 'renewal';
  if (name.includes('expan') || name.includes('upsell') || name.includes('cross')) return 'expansion';
  return 'new_business';
}
```

Store the resolved `pipelineType` in the skill run output so the frontend can display it.

---

## Change 2: Filter All Distribution Queries by `pipeline_id`

In `server/analysis/monte-carlo-distributions.ts`, add `pipelineId?: string | null` to every function signature and apply the filter to every SQL query.

Pattern to apply across all five functions:

```typescript
// In function signature:
pipelineId?: string | null

// In WHERE clause (after existing workspace_id filter):
${pipelineId ? `AND d.pipeline_id = $${paramIndex}` : ''}

// In params array:
...(pipelineId ? [pipelineId] : [])
```

Apply to:
- `fitStageWinRates` — filter on `deals` side of the join with `deal_stage_history`. **The pipeline filter goes on `d.pipeline_id`, not on `dsh`.**
- `fitDealSizeDistribution` — filter on `deals`
- `fitCycleLengthDistribution` — filter on `deals`
- `fitCloseSlippageDistribution` — filter on `deals`
- `fitPipelineCreationRates` — filter on `deals`

Also apply to the open deals query in `mcLoadOpenDeals` in `server/skills/tool-definitions.ts`.

Also apply to `computeDealRiskAdjustments` in `monte-carlo-engine.ts`.

---

## Change 3: Fork Component B by Pipeline Type

This is the most significant change. In `server/analysis/monte-carlo-engine.ts`, replace the current Component B block in `runIteration()` with a dispatch based on `pipelineType`.

Add `pipelineType: PipelineType` to `SimulationInputs`.

### new_business — unchanged

```typescript
if (pipelineType === 'new_business') {
  // Existing Component B logic — no changes
  // Sample from pipelineCreationRates, draw cycle length, apply team win rate
}
```

### renewal — fixed population, no generation

```typescript
if (pipelineType === 'renewal') {
  // Component B is disabled for renewals.
  // Future renewal deals are loaded as known upcoming deals, not simulated.
  // They are passed in as `upcomingRenewals: UpcomingRenewal[]` on SimulationInputs.
  // Each upcoming renewal gets the same win/loss simulation as Component A
  // (Bernoulli trial on win rate, no close date slippage since renewal dates are contractual).

  for (const renewal of inputs.upcomingRenewals ?? []) {
    const winRate = sampleBeta(
      inputs.distributions.stageWinRates['renewal']?.alpha ?? 7,
      inputs.distributions.stageWinRates['renewal']?.beta  ?? 3
    );
    if (!sampleBernoulli(winRate)) continue;
    if (renewal.expectedCloseDate > inputs.forecastWindowEnd) continue;

    // Renewal amount: sample from a tight distribution around contract value.
    // Renewals don't vary as much as new business — use smaller sigma.
    const amount = sampleLogNormal(
      Math.log(renewal.contractValue),
      inputs.distributions.dealSize.sigma * 0.15
    );
    projectedRevenue += amount;
  }
}
```

`upcomingRenewals` is loaded in a new compute step (see Change 4 below).

### expansion — bounded by customer base

```typescript
if (pipelineType === 'expansion') {
  // Component B is bounded by existing customer ARR.
  // Addressable expansion pool = sum of active customer ARR × expansionRateDistribution.
  // Draw from that pool rather than from rep pipeline creation rates.

  const customerBaseARR = inputs.customerBaseARR ?? 0;
  if (customerBaseARR === 0) {
    inputs.dataQuality.warnings.push(
      'Customer base ARR not available — expansion Component B skipped'
    );
  } else {
    const expansionRateMu    = inputs.distributions.expansionRate?.mean  ?? 0.15;
    const expansionRateSigma = inputs.distributions.expansionRate?.sigma ?? 0.08;
    const expansionRate = Math.max(0, sampleNormal(expansionRateMu, expansionRateSigma));

    // Expansion cycles tend to be shorter — use 0.7× of the standard cycle length
    const cycleMonths = sampleLogNormal(
      inputs.distributions.cycleLength.mu,
      inputs.distributions.cycleLength.sigma
    ) / 30 * 0.7;

    const daysRemaining  = daysBetween(inputs.today, inputs.forecastWindowEnd);
    const monthsRemaining = daysRemaining / 30;
    const windowFraction = Math.min(1, monthsRemaining / cycleMonths);

    const expansionWinRate = sampleBeta(
      inputs.distributions.stageWinRates['expansion']?.alpha ?? 6,
      inputs.distributions.stageWinRates['expansion']?.beta  ?? 4
    );

    const expansionRevenue = customerBaseARR * expansionRate * windowFraction * expansionWinRate;
    projectedRevenue += expansionRevenue;
  }
}
```

---

## Change 4: New Compute Step for Renewals — `load-upcoming-renewals`

Add a new compute step to the skill definition, inserted between `load-open-deals` and `compute-risk-adjustments`. Only execute when `pipelineType === 'renewal'`; otherwise pass through with empty output.

```
Step 3b: load-upcoming-renewals (COMPUTE) — renewal pipelines only
  - Query deals where:
      pipeline_id = pipelineId (if set)
      workspace_id = workspaceId
      stage_normalized != 'closed_won' AND stage_normalized != 'closed_lost'
      close_date BETWEEN today AND forecastWindowEnd
  - For each: extract amount as contractValue, close_date as expectedCloseDate
  - Also check custom_fields JSONB for keys matching: 'renewal_date', 'contract_end_date',
    'renewal_due_date' — use these as expectedCloseDate if close_date is null
  - Output: {
      upcomingRenewals: [{ dealId, name, contractValue, expectedCloseDate, owner }],
      renewalCount: number,
      totalRenewalValue: number
    }
  - If pipelineType !== 'renewal': return { upcomingRenewals: [], renewalCount: 0, totalRenewalValue: 0 }
```

---

## Change 5: New Distribution — Expansion Rate

Add a sixth fitting function to `monte-carlo-distributions.ts` for expansion pipelines. Only called when `pipelineType === 'expansion'`; otherwise returns null and is skipped.

```typescript
export async function fitExpansionRateDistribution(
  workspaceId: string,
  db: DatabaseClient,
  pipelineId?: string | null,
  lookbackMonths: number = 24
): Promise<(NormalDistribution & { customerBaseARR: number }) | null>
```

**Historical expansion rate SQL:**
```sql
SELECT
  AVG(d.amount / NULLIF(a.arr, 0))    AS mean_expansion_rate,
  STDDEV(d.amount / NULLIF(a.arr, 0)) AS sigma_expansion_rate,
  COUNT(*)                             AS sample_size
FROM deals d
JOIN accounts a ON d.account_id = a.id
WHERE d.workspace_id = $1
  AND d.is_closed_won = true
  AND d.closed_at > NOW() - INTERVAL '24 months'
  ${pipelineId ? 'AND d.pipeline_id = $2' : ''}
  AND a.arr > 0
```

**Customer base ARR SQL:**
```sql
SELECT COALESCE(SUM(arr), 0) AS customer_base_arr
FROM accounts
WHERE workspace_id = $1
```

If `accounts.arr` is not populated (all zeros), fall back to summing closed-won deal amounts from the last 12 months as a proxy for customer base size. Flag this in `dataQuality.warnings`.

If `sample_size < 5`, return default `Normal(0.15, 0.08)` and flag as unreliable.

---

## Change 6: Update Variance Drivers by Pipeline Type

In `server/analysis/monte-carlo-variance.ts`, add `pipelineType: PipelineType` to the `computeVarianceDrivers` function signature. Conditionally include/exclude variables:

```typescript
const variablesToPerturb = {
  new_business: [
    'win_rate', 'deal_size', 'cycle_length',
    'close_date_slippage', 'pipeline_creation_rate'
  ],
  renewal: [
    'win_rate', 'deal_size', 'close_date_slippage', 'renewal_count'
  ],
  expansion: [
    'win_rate', 'expansion_rate', 'deal_size',
    'customer_base_arr', 'cycle_length'
  ],
};
```

**Renewal perturbations:**
- `win_rate` — same as new_business
- `deal_size` — same as new_business
- `close_date_slippage` — same as new_business
- `renewal_count` — perturb `upcomingRenewals.length` by ±20%

**Expansion perturbations:**
- `win_rate` — same as new_business
- `expansion_rate` — perturb `expansionRate.mean` by ±1σ
- `deal_size` — same as new_business
- `customer_base_arr` — perturb `customerBaseARR` by ±20%
- `cycle_length` — same as new_business

The tornado chart labels update accordingly. "Pipeline creation" will never appear on a Renewal or Expansion forecast.

---

## Change 7: New Endpoint — List Available Pipelines

Add to `server/routes/skills.ts`:

```
GET /api/workspaces/:workspaceId/monte-carlo/pipelines
```

```sql
SELECT
  pipeline_id,
  pipeline_name,
  COUNT(*)                  AS deal_count,
  COALESCE(SUM(amount), 0)  AS total_value
FROM deals
WHERE workspace_id = $1
  AND pipeline_id IS NOT NULL
  AND is_deleted = false
GROUP BY pipeline_id, pipeline_name
ORDER BY total_value DESC
```

Response:
```typescript
{
  pipelines: [
    {
      id: string,
      name: string,
      dealCount: number,
      totalValue: number,
      inferredType: 'new_business' | 'renewal' | 'expansion'
    }
  ]
}
```

Apply `inferPipelineType()` (from Change 1) to each pipeline name to populate `inferredType`.

---

## Change 8: Store Pipeline Context in Skill Run Output

In the `command_center` payload stored to `skill_runs.result_data`, add:

```typescript
pipelineId: string | null
pipelineLabel: string | null
pipelineType: PipelineType
componentBMethod: 'generation' | 'fixed_population' | 'bounded_expansion'
```

`componentBMethod` maps from `pipelineType`:
- `new_business` → `'generation'`
- `renewal`      → `'fixed_population'`
- `expansion`    → `'bounded_expansion'`

---

## Change 9: Extend `/latest` Endpoint for Pipeline Scoping

```
GET /api/workspaces/:workspaceId/monte-carlo/latest?pipelineId=123
GET /api/workspaces/:workspaceId/monte-carlo/latest          ← all pipelines
```

In the route handler WHERE clause:

```sql
-- With pipelineId:
AND result_data->>'pipelineId' = $2

-- Without pipelineId (all pipelines):
AND (result_data->>'pipelineId' IS NULL OR result_data->>'pipelineId' = 'null')
```

---

## What NOT to Change

- Core simulation math in `runIteration()` outside of the Component B fork
- Component A logic (existing open deals) — identical across all pipeline types
- DeepSeek and Claude prompt templates — no changes needed
- Skill registration or cron schedule
- Any other skills

---

## Test Sequence

**Imubit (Salesforce — single New Business pipeline):**
1. `GET /api/workspaces/{imubit_id}/monte-carlo/pipelines` — should return pipeline(s) with `inferredType: 'new_business'`
2. Run with no `pipelineId` — existing behavior unchanged, Component B uses creation rates
3. Confirm `componentBMethod: 'generation'` in result payload

**Frontera (HubSpot — multiple pipelines):**
1. `GET /api/workspaces/{frontera_id}/monte-carlo/pipelines` — should return 3+ pipelines with inferred types
2. Run against New Business pipeline — Component B uses creation rates, tornado shows "Pipeline creation"
3. Run against Renewal pipeline — Component B loads upcoming renewals from deals table, tornado shows "Win rate" and "Renewal count", no "Pipeline creation"
4. Run against Expansion pipeline — Component B draws from customer base ARR pool, tornado shows "Expansion rate" and "Customer base ARR"
5. Confirm each run is stored separately in `skill_runs` with distinct `pipelineId` values
6. Confirm `/latest?pipelineId=X` returns the correct run for each pipeline

---

## Token Budget — Unchanged

All pipeline type changes are compute-only. DeepSeek and Claude receive the same aggregated summaries regardless of pipeline type. Token budget remains ~8,300 tokens per run.

---

## Commit Message

```
feat: add pipeline_id scoping and pipeline-type-aware Component B to monte-carlo-forecast skill
```
