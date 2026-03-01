# Claude Code Prompt: Goals, Motions, Persistence & Investigation Engine

## Context

Pandora needs four interconnected capabilities to become truly agentic:

1. **Structured Goals with Revenue Motions** — decompose board targets into motion-specific goals (new business, expansion, renewal) with funnel math, so every skill finding has a "so what" measured against a target with a deadline.
2. **Finding Persistence & Trending** — track whether flagged issues resolve or worsen across runs, enabling follow-through ("I flagged this Monday, it's Wednesday, nothing changed — escalating").
3. **Cross-Skill Reasoning** — when one operator's finding raises a question, another operator investigates automatically, building causal chains instead of parallel summaries.
4. **Goal-Aware Question Handling** — the orchestrator plans investigations dynamically using goals as the frame, persistence as memory, and cross-skill reasoning as the method.

These four compound: goals give findings meaning, persistence gives findings memory, cross-skill reasoning gives findings depth, and goal-aware question handling ties them together into a system that investigates rather than retrieves.

---

## Before You Start — Read These Files

**Database schemas (understand what exists):**
1. `server/db/migrations/` — scan for these specific migrations:
   - Migration 011/012: `quota_periods` + `rep_quotas` tables
   - Migration 064/075: older `targets` / `quotas` tables (has pipeline_id/pipeline_name)
   - Migration 046: `stage_configs` table
   - Migration 058: `analysis_scopes` table
   - Migration 025 + 122: `findings` table (full schema with severity, assumptions, etc.)
   - Migration 003: `context_layer` table
   - The `sales_reps` table (has `team` TEXT column, `org_role_id`)
   - The `org_roles` table
   - The `v_deal_owners_with_rep_status` view

2. `server/types/workspace-config.ts` — the WorkspaceConfig type. You're extending ThresholdConfig.
3. `server/config/workspace-config-loader.ts` — the config loader. You're adding goal context to what it resolves.
4. `server/skills/runtime.ts` — SkillRuntime.executeSkill() signature and how params flow in.
5. `server/agents/runtime.ts` — AgentRuntime.executeAgent() and how businessContext is built before skill execution.
6. `server/chat/orchestrator.ts` — the multi-layer hybrid router. You're adding an investigation planner at layer 4.5.
7. `server/chat/intent-classifier.ts` or wherever `classifyDirectQuestion()` lives.
8. The `forecast-snapshots` table — forecast-rollup writes by_rep data here separately from skill_runs.
9. Any existing findings extraction logic — how do skill results get written to the findings table today?

**Understanding current skill output shapes:**
- `pipeline-hygiene` result: `{ stale_deals_agg: { topDeals: [...], bySeverity: {...} }, deal_classifications: [...], pipeline_summary: {...} }`
- `forecast-rollup` result: `{ risk_classifications: "[JSON string or parsed array]" }` — plus separate forecast-snapshots table for by_rep data
- `rep-scorecard` result: flexible shape, extractor scans for flagged/alert/risk/issue truthy fields

**Key architectural facts from the audit:**
- `deals.pipeline` is TEXT (pipeline name), no pipeline_id on deals table
- `stage_configs` has pipeline_name + stage_name + display_order per workspace — the system knows which pipelines exist
- `analysis_scopes` can filter by pipeline at runtime (filter_field = 'pipeline', filter_values IN deals.pipeline)
- `goals_and_targets` in context_layer is narrative text ("hit $10M ARR"), not structured numbers — quotas live in quota_periods/rep_quotas
- Config loader is fully wired — skills read thresholds via configLoader.getConfig() and via businessContext Handlebars injection
- Team hierarchy doesn't exist — sales_reps.team is a free-text label, no manager relationship, no rollup logic
- No teams or team_members table
- Findings table has no agent_id — attached to skill_run_id. Has severity ('act','watch','notable','info'), deal_id, account_id, assumptions JSONB
- Latest migration is 122. Next is 123.

---

## Task 1: Revenue Motions & Structured Goals

### 1A: Database Migration — `123_revenue_motions_and_goals.sql`

```sql
-- ============================================================
-- REVENUE MOTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS revenue_motions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  
  -- Identity
  type TEXT NOT NULL CHECK (type IN ('new_business', 'expansion', 'renewal')),
  sub_type TEXT,  -- 'outbound', 'inbound', 'partner', 'upsell', 'cross_sell'
  label TEXT NOT NULL,  -- "Outbound New Business", "Renewal", "Expansion - Upsell"
  
  -- CRM mapping: which pipeline(s) feed this motion
  -- Uses pipeline NAME (TEXT) to match deals.pipeline and stage_configs.pipeline_name
  pipeline_names TEXT[] NOT NULL DEFAULT '{}',
  
  -- Additional deal filters beyond pipeline (for single-pipeline workspaces
  -- that use deal_type or record_type to distinguish motions)
  deal_filters JSONB DEFAULT '{}',
  -- e.g. { "custom_field": "dealtype", "values": ["newbusiness", "new"] }
  -- or { "custom_field": "record_type_name", "values": ["Renewal"] } for Salesforce
  
  -- Team assignment (optional — which teams work this motion)
  team_labels TEXT[] DEFAULT '{}',  -- matches sales_reps.team values
  
  -- Funnel model (computed from historical data, user can override)
  funnel_model JSONB DEFAULT '{}',
  -- {
  --   "win_rate": 0.28,
  --   "avg_deal_size": 72000,
  --   "avg_cycle_days": 85,
  --   "stage_conversion_rates": { "Discovery→Evaluation": 0.65, "Evaluation→Proposal": 0.55, ... },
  --   "source": "inferred",  -- or "manual"
  --   "computed_at": "2025-01-15T..."
  -- }
  
  -- Motion-specific thresholds (override workspace defaults when skills run scoped to this motion)
  thresholds_override JSONB DEFAULT '{}',
  -- {
  --   "stale_deal_days": 14,        -- new biz: 14 days
  --   "coverage_target": 3.0,       -- new biz needs 3×
  --   "minimum_contacts": 3,        -- enterprise new biz multi-threading
  --   "expected_days_in_stage": { "Discovery": 14, "Proposal": 21 }
  -- }
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'inferred', 'crm_import')),
  confidence FLOAT DEFAULT 1.0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(workspace_id, type, sub_type)
);

CREATE INDEX idx_revenue_motions_workspace ON revenue_motions(workspace_id) WHERE is_active = true;

-- ============================================================
-- STRUCTURED GOALS (hierarchical, motion-aware)
-- ============================================================

CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  
  -- What this goal measures
  metric_type TEXT NOT NULL CHECK (metric_type IN (
    'bookings', 'pipeline', 'opportunities', 'sqls', 'mqls', 
    'leads', 'visits', 'win_rate', 'cycle_time', 'retention', 
    'expansion_revenue', 'churn', 'nrr', 'custom'
  )),
  label TEXT NOT NULL,  -- "Q1 New Business Bookings", "Outbound Pipeline Target"
  
  -- Hierarchy — vertical (who owns it)
  level TEXT NOT NULL CHECK (level IN ('board', 'company', 'team', 'individual')),
  parent_goal_id UUID REFERENCES goals(id),  -- board → company → team → individual
  
  -- Owner
  owner_type TEXT NOT NULL CHECK (owner_type IN ('workspace', 'team', 'rep')),
  owner_id TEXT NOT NULL,  -- workspace_id for company-level, team label for team, rep_name for individual
  
  -- Motion linkage (nullable — some goals span all motions)
  motion_id UUID REFERENCES revenue_motions(id),
  
  -- Funnel linkage — horizontal cascade
  -- A pipeline goal is upstream of a bookings goal
  upstream_goal_id UUID REFERENCES goals(id),
  conversion_assumption FLOAT,  -- the rate linking this to upstream (e.g., 0.28 win rate)
  
  -- Target
  target_value NUMERIC(15,2) NOT NULL,
  target_unit TEXT DEFAULT 'currency',  -- 'currency', 'count', 'percentage', 'days'
  period TEXT NOT NULL CHECK (period IN ('monthly', 'quarterly', 'annual')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  
  -- Source tracking
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'inferred', 'quota_import', 'crm_import')),
  confidence FLOAT DEFAULT 1.0,
  inferred_from TEXT,  -- "Derived from $14M bookings target at 28% win rate"
  
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_goals_workspace_active ON goals(workspace_id) WHERE is_active = true;
CREATE INDEX idx_goals_motion ON goals(motion_id) WHERE motion_id IS NOT NULL;
CREATE INDEX idx_goals_parent ON goals(parent_goal_id) WHERE parent_goal_id IS NOT NULL;
CREATE INDEX idx_goals_period ON goals(workspace_id, period_start, period_end);

-- ============================================================
-- GOAL SNAPSHOTS (daily time-series for trending)
-- ============================================================

CREATE TABLE IF NOT EXISTS goal_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  snapshot_date DATE NOT NULL,
  
  -- Point-in-time values
  current_value NUMERIC(15,2) NOT NULL,
  attainment_pct NUMERIC(5,2),  -- current / target * 100
  gap NUMERIC(15,2),  -- target - current (positive = behind)
  
  -- Trajectory
  required_run_rate NUMERIC(15,2),  -- what's needed per week to close gap
  actual_run_rate NUMERIC(15,2),    -- trailing 4-week average
  trajectory TEXT CHECK (trajectory IN ('ahead', 'on_track', 'at_risk', 'behind', 'critical')),
  projected_landing NUMERIC(15,2),  -- linear projection based on actual run rate
  days_remaining INT,
  
  -- Context from that day's skill runs
  top_risk TEXT,
  top_opportunity TEXT,
  notable_changes TEXT[],
  
  -- Supporting data for the snapshot computation
  computation_detail JSONB DEFAULT '{}',
  -- { "pipeline_value": 2400000, "closed_won": 1800000, "deals_in_commit": 5, 
  --   "deals_closed_this_week": 2, "pipeline_created_this_week": 350000 }
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(goal_id, snapshot_date)
);

CREATE INDEX idx_goal_snapshots_date ON goal_snapshots(goal_id, snapshot_date DESC);
CREATE INDEX idx_goal_snapshots_workspace ON goal_snapshots(workspace_id, snapshot_date DESC);

-- ============================================================
-- TEAM HIERARCHY (minimal, extends sales_reps)
-- ============================================================

-- Add manager relationship to sales_reps
ALTER TABLE sales_reps
  ADD COLUMN IF NOT EXISTS manager_rep_id UUID REFERENCES sales_reps(id),
  ADD COLUMN IF NOT EXISTS is_manager BOOLEAN DEFAULT false;

-- Create index for team rollup queries
CREATE INDEX IF NOT EXISTS idx_sales_reps_manager ON sales_reps(manager_rep_id) WHERE manager_rep_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_reps_team ON sales_reps(workspace_id, team) WHERE team IS NOT NULL;

-- ============================================================
-- EXTEND quota_periods WITH MOTION LINKAGE
-- ============================================================

ALTER TABLE quota_periods
  ADD COLUMN IF NOT EXISTS motion_id UUID REFERENCES revenue_motions(id),
  ADD COLUMN IF NOT EXISTS pipeline_name TEXT;

-- Extend rep_quotas to optionally link to a motion
ALTER TABLE rep_quotas
  ADD COLUMN IF NOT EXISTS motion_id UUID REFERENCES revenue_motions(id);

COMMENT ON COLUMN quota_periods.motion_id IS 'Links quota period to a revenue motion for per-motion quota tracking';
COMMENT ON COLUMN quota_periods.pipeline_name IS 'Pipeline name this quota period applies to (matches deals.pipeline)';
```

### 1B: Revenue Motion Service

Create `server/goals/motion-service.ts`:

```typescript
// server/goals/motion-service.ts

export interface RevenueMotion {
  id: string;
  workspace_id: string;
  type: 'new_business' | 'expansion' | 'renewal';
  sub_type: string | null;
  label: string;
  pipeline_names: string[];
  deal_filters: Record<string, any>;
  team_labels: string[];
  funnel_model: FunnelModel;
  thresholds_override: Record<string, any>;
  is_active: boolean;
  source: 'manual' | 'inferred' | 'crm_import';
  confidence: number;
}

export interface FunnelModel {
  win_rate: number;
  avg_deal_size: number;
  avg_cycle_days: number;
  stage_conversion_rates: Record<string, number>;
  source: 'inferred' | 'manual';
  computed_at: string;
}

export class MotionService {
  // CRUD
  async create(workspaceId: string, motion: Partial<RevenueMotion>): Promise<RevenueMotion>;
  async update(motionId: string, updates: Partial<RevenueMotion>): Promise<RevenueMotion>;
  async list(workspaceId: string): Promise<RevenueMotion[]>;
  async getById(motionId: string): Promise<RevenueMotion | null>;
  async getByPipelineName(workspaceId: string, pipelineName: string): Promise<RevenueMotion | null>;
  
  // Get the effective thresholds for a motion (motion override merged with workspace defaults)
  async getEffectiveThresholds(workspaceId: string, motionId: string): Promise<ThresholdConfig> {
    const config = await configLoader.getConfig(workspaceId);
    const motion = await this.getById(motionId);
    
    // Motion thresholds override workspace defaults
    return {
      ...config.thresholds,
      ...(motion?.thresholds_override || {}),
    };
  }
}
```

### 1C: Motion Inference Engine

Create `server/goals/motion-inference.ts`:

This runs after CRM sync completes (or on demand). It examines pipeline structure and deal properties to infer motions.

```typescript
// server/goals/motion-inference.ts

export async function inferMotions(workspaceId: string): Promise<InferredMotion[]> {
  const inferred: InferredMotion[] = [];
  
  // 1. Get all pipeline names from stage_configs
  const pipelines = await query(`
    SELECT DISTINCT pipeline_name FROM stage_configs 
    WHERE workspace_id = $1
  `, [workspaceId]);
  
  // 2. Classify each pipeline by name
  for (const row of pipelines.rows) {
    const name = row.pipeline_name.toLowerCase();
    
    if (matchesRenewal(name)) {
      // Keywords: "renewal", "renew", "retention"
      inferred.push({
        type: 'renewal',
        label: row.pipeline_name,
        pipeline_names: [row.pipeline_name],
        confidence: 0.9,
      });
    } else if (matchesExpansion(name)) {
      // Keywords: "expansion", "upsell", "cross-sell", "grow", "existing"
      inferred.push({
        type: 'expansion',
        sub_type: name.includes('upsell') ? 'upsell' : name.includes('cross') ? 'cross_sell' : null,
        label: row.pipeline_name,
        pipeline_names: [row.pipeline_name],
        confidence: 0.85,
      });
    } else {
      // Default: new business
      inferred.push({
        type: 'new_business',
        label: row.pipeline_name,
        pipeline_names: [row.pipeline_name],
        confidence: 0.7,
      });
    }
  }
  
  // 3. If only ONE pipeline exists, check deal_type/dealtype custom field for motion segmentation
  if (pipelines.rows.length === 1) {
    const dealTypes = await query(`
      SELECT DISTINCT custom_fields->>'dealtype' as deal_type, COUNT(*) as cnt
      FROM deals WHERE workspace_id = $1 AND custom_fields->>'dealtype' IS NOT NULL
      GROUP BY custom_fields->>'dealtype'
    `, [workspaceId]);
    
    if (dealTypes.rows.length > 1) {
      // Single pipeline, multiple deal types → create motions based on deal_type
      inferred.length = 0; // Clear pipeline-based inferences
      
      for (const dt of dealTypes.rows) {
        const type = classifyDealType(dt.deal_type);
        inferred.push({
          type: type.motion,
          sub_type: type.sub_type,
          label: `${dt.deal_type} (${pipelines.rows[0].pipeline_name})`,
          pipeline_names: [pipelines.rows[0].pipeline_name],
          deal_filters: { custom_field: 'dealtype', values: [dt.deal_type] },
          confidence: 0.75,
        });
      }
    }
  }
  
  // 4. Compute funnel model for each inferred motion
  for (const motion of inferred) {
    motion.funnel_model = await computeFunnelModel(workspaceId, motion);
  }
  
  return inferred;
}

// Compute historical win rate, avg deal size, avg cycle from deals matching this motion's filters
async function computeFunnelModel(workspaceId: string, motion: InferredMotion): Promise<FunnelModel> {
  // Build WHERE clause from motion's pipeline_names and deal_filters
  // Query closed-won and closed-lost deals from last 12 months
  // Calculate: win_rate, avg_deal_size (won deals), avg_cycle_days (won deals)
  // Calculate stage-to-stage conversion rates from stage history if available,
  // otherwise from current stage distribution
  
  // Return FunnelModel with source: 'inferred'
}

// Helper: classify deal_type string into motion type
function classifyDealType(dealType: string): { motion: string; sub_type: string | null } {
  const lower = dealType.toLowerCase();
  if (/renew|retention/.test(lower)) return { motion: 'renewal', sub_type: null };
  if (/expan|upsell|grow|upgrade/.test(lower)) return { motion: 'expansion', sub_type: 'upsell' };
  if (/cross.?sell|add.?on/.test(lower)) return { motion: 'expansion', sub_type: 'cross_sell' };
  return { motion: 'new_business', sub_type: null };
}
```

### 1D: Goal Service with Funnel Cascade

Create `server/goals/goal-service.ts`:

```typescript
// server/goals/goal-service.ts

export class GoalService {
  // CRUD
  async create(workspaceId: string, goal: CreateGoalInput): Promise<Goal>;
  async update(goalId: string, updates: Partial<Goal>): Promise<Goal>;
  async list(workspaceId: string, filters?: { motion_id?: string; level?: string; period_start?: Date }): Promise<Goal[]>;
  async getById(goalId: string): Promise<Goal | null>;
  async getTree(workspaceId: string, rootGoalId: string): Promise<GoalTree>;
  
  // The key method: given a top-line bookings goal, infer the full funnel cascade
  async inferDownstreamGoals(workspaceId: string, bookingsGoalId: string): Promise<Goal[]> {
    const bookingsGoal = await this.getById(bookingsGoalId);
    if (!bookingsGoal) throw new Error('Goal not found');
    
    const motion = bookingsGoal.motion_id 
      ? await motionService.getById(bookingsGoal.motion_id) 
      : null;
    
    const funnel = motion?.funnel_model;
    if (!funnel) return []; // Can't infer without funnel model
    
    const inferred: CreateGoalInput[] = [];
    
    // Bookings → Pipeline needed
    const pipelineNeeded = bookingsGoal.target_value / funnel.win_rate;
    inferred.push({
      metric_type: 'pipeline',
      label: `${motion.label} Pipeline Target`,
      level: bookingsGoal.level,
      parent_goal_id: bookingsGoal.parent_goal_id,
      upstream_goal_id: bookingsGoal.id,
      conversion_assumption: funnel.win_rate,
      owner_type: bookingsGoal.owner_type,
      owner_id: bookingsGoal.owner_id,
      motion_id: bookingsGoal.motion_id,
      target_value: pipelineNeeded,
      target_unit: 'currency',
      period: bookingsGoal.period,
      period_start: bookingsGoal.period_start,
      period_end: bookingsGoal.period_end,
      source: 'inferred',
      confidence: funnel.source === 'manual' ? 0.9 : 0.7,
      inferred_from: `Derived from $${bookingsGoal.target_value} bookings target at ${(funnel.win_rate * 100).toFixed(0)}% win rate`,
    });
    
    // Pipeline → Opportunities needed
    if (funnel.avg_deal_size > 0) {
      const oppsNeeded = Math.ceil(pipelineNeeded / funnel.avg_deal_size);
      inferred.push({
        metric_type: 'opportunities',
        label: `${motion.label} Opportunity Target`,
        level: bookingsGoal.level,
        upstream_goal_id: null, // Will be set after pipeline goal is created
        conversion_assumption: funnel.avg_deal_size,
        target_value: oppsNeeded,
        target_unit: 'count',
        // ... same period/owner/motion as above
        source: 'inferred',
        inferred_from: `Derived from $${pipelineNeeded.toFixed(0)} pipeline target at $${funnel.avg_deal_size} avg deal size`,
      });
    }
    
    // Create all inferred goals, linking upstream_goal_ids after creation
    const created = [];
    for (const goalInput of inferred) {
      const goal = await this.create(workspaceId, goalInput);
      created.push(goal);
    }
    
    // Fix upstream linkages (pipeline goal → opp goal)
    if (created.length >= 2) {
      await this.update(created[1].id, { upstream_goal_id: created[0].id });
    }
    
    return created;
  }
  
  // Get current value for a goal (computed from live data, not stored)
  async computeCurrentValue(workspaceId: string, goal: Goal): Promise<GoalCurrentValue> {
    const motion = goal.motion_id ? await motionService.getById(goal.motion_id) : null;
    
    // Build deal filter based on motion
    const dealFilter = buildDealFilter(motion);
    
    switch (goal.metric_type) {
      case 'bookings': {
        // Sum of closed-won deals in this period matching this motion's pipeline/filters
        const result = await query(`
          SELECT COALESCE(SUM(amount), 0) as current_value, COUNT(*) as deal_count
          FROM deals 
          WHERE workspace_id = $1 
            AND stage IN (SELECT stage_name FROM stage_configs WHERE workspace_id = $1 AND is_won = true)
            AND close_date >= $2 AND close_date <= $3
            ${dealFilter.whereClause}
        `, [workspaceId, goal.period_start, goal.period_end, ...dealFilter.params]);
        
        return {
          current_value: result.rows[0].current_value,
          deal_count: result.rows[0].deal_count,
        };
      }
      
      case 'pipeline': {
        // Sum of open deals matching this motion
        const result = await query(`
          SELECT COALESCE(SUM(amount), 0) as current_value, COUNT(*) as deal_count
          FROM deals 
          WHERE workspace_id = $1 
            AND stage NOT IN (SELECT stage_name FROM stage_configs WHERE workspace_id = $1 AND (is_won = true OR is_lost = true))
            AND close_date <= $2
            ${dealFilter.whereClause}
        `, [workspaceId, goal.period_end, ...dealFilter.params]);
        
        return {
          current_value: result.rows[0].current_value,
          deal_count: result.rows[0].deal_count,
        };
      }
      
      case 'opportunities': {
        // Count of open + won deals created in period matching motion
        // ... similar pattern
      }
      
      case 'retention': {
        // For renewal motions: renewal rate = renewed_value / up_for_renewal_value
        // This needs the renewal base — deals with renewal dates in the period
        // Compute from deals where deal_type indicates renewal
      }
      
      case 'nrr': {
        // Net revenue retention: (renewals + expansion - churn) / beginning ARR
        // Requires expansion and renewal motions to both exist
      }
      
      // ... other metric types
    }
  }
}

function buildDealFilter(motion: RevenueMotion | null): { whereClause: string; params: any[] } {
  if (!motion) return { whereClause: '', params: [] };
  
  const clauses: string[] = [];
  const params: any[] = [];
  let paramIdx = 10; // Start high to avoid collision with caller's params
  
  if (motion.pipeline_names.length > 0) {
    clauses.push(`AND pipeline = ANY($${paramIdx})`);
    params.push(motion.pipeline_names);
    paramIdx++;
  }
  
  if (motion.deal_filters?.custom_field && motion.deal_filters?.values) {
    clauses.push(`AND custom_fields->>'${motion.deal_filters.custom_field}' = ANY($${paramIdx})`);
    params.push(motion.deal_filters.values);
    paramIdx++;
  }
  
  return { whereClause: clauses.join(' '), params };
}
```

### 1E: Goal Snapshot Engine

Create `server/goals/snapshot-engine.ts`:

This runs daily (or after each agent/skill run cycle) to capture goal progress over time.

```typescript
// server/goals/snapshot-engine.ts

export async function captureGoalSnapshots(workspaceId: string): Promise<void> {
  const goals = await goalService.list(workspaceId, { is_active: true });
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  for (const goal of goals) {
    // Skip if we already snapped today
    const existing = await query(
      `SELECT id FROM goal_snapshots WHERE goal_id = $1 AND snapshot_date = $2`,
      [goal.id, today]
    );
    if (existing.rows.length > 0) continue;
    
    // Compute current value
    const current = await goalService.computeCurrentValue(workspaceId, goal);
    
    // Compute trajectory
    const daysRemaining = daysBetween(new Date(), new Date(goal.period_end));
    const daysElapsed = daysBetween(new Date(goal.period_start), new Date());
    const gap = goal.target_value - current.current_value;
    const attainmentPct = goal.target_value > 0 
      ? (current.current_value / goal.target_value) * 100 
      : 0;
    
    // Trailing 4-week run rate from previous snapshots
    const priorSnapshots = await query(`
      SELECT current_value, snapshot_date FROM goal_snapshots
      WHERE goal_id = $1 AND snapshot_date >= $2
      ORDER BY snapshot_date ASC
    `, [goal.id, formatDate(subWeeks(new Date(), 4))]);
    
    let actualRunRate = 0;
    if (priorSnapshots.rows.length >= 2) {
      const oldest = priorSnapshots.rows[0];
      const weeksBetween = daysBetween(new Date(oldest.snapshot_date), new Date()) / 7;
      actualRunRate = weeksBetween > 0 
        ? (current.current_value - oldest.current_value) / weeksBetween 
        : 0;
    }
    
    const weeksRemaining = daysRemaining / 7;
    const requiredRunRate = weeksRemaining > 0 ? gap / weeksRemaining : gap;
    const projectedLanding = current.current_value + (actualRunRate * weeksRemaining);
    
    // Classify trajectory
    const trajectory = classifyTrajectory(attainmentPct, daysElapsed, daysRemaining, actualRunRate, requiredRunRate);
    
    // Get top risk/opportunity from recent findings
    const recentFindings = await query(`
      SELECT message, severity FROM findings 
      WHERE workspace_id = $1 AND severity IN ('act', 'watch') 
        AND created_at >= NOW() - INTERVAL '24 hours'
      ORDER BY severity ASC, created_at DESC LIMIT 2
    `, [workspaceId]);
    
    const topRisk = recentFindings.rows.find(f => f.severity === 'act')?.message || null;
    const topOpportunity = recentFindings.rows.find(f => f.severity === 'watch')?.message || null;
    
    // Insert snapshot
    await query(`
      INSERT INTO goal_snapshots 
        (goal_id, workspace_id, snapshot_date, current_value, attainment_pct, gap,
         required_run_rate, actual_run_rate, trajectory, projected_landing, days_remaining,
         top_risk, top_opportunity, computation_detail)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [goal.id, workspaceId, today, current.current_value, attainmentPct, gap,
        requiredRunRate, actualRunRate, trajectory, projectedLanding, daysRemaining,
        topRisk, topOpportunity, JSON.stringify(current)]);
  }
}

function classifyTrajectory(
  attainmentPct: number, daysElapsed: number, daysRemaining: number,
  actualRunRate: number, requiredRunRate: number
): string {
  const expectedPctAtThisPoint = (daysElapsed / (daysElapsed + daysRemaining)) * 100;
  
  if (attainmentPct >= 100) return 'ahead';
  if (attainmentPct >= expectedPctAtThisPoint * 0.95) return 'on_track';
  if (actualRunRate >= requiredRunRate * 0.7) return 'at_risk';
  if (actualRunRate >= requiredRunRate * 0.4) return 'behind';
  return 'critical';
}
```

### 1F: API Endpoints

Add to existing routes or create new route files:

```
-- Revenue Motions
GET    /api/workspaces/:id/motions                    → list active motions
POST   /api/workspaces/:id/motions                    → create motion
PUT    /api/workspaces/:id/motions/:motionId           → update motion
DELETE /api/workspaces/:id/motions/:motionId           → soft delete (is_active = false)
POST   /api/workspaces/:id/motions/infer               → run inference, return suggestions (don't auto-create)

-- Goals
GET    /api/workspaces/:id/goals                       → list active goals (filters: motion_id, level, period)
POST   /api/workspaces/:id/goals                       → create goal
PUT    /api/workspaces/:id/goals/:goalId                → update goal
DELETE /api/workspaces/:id/goals/:goalId                → soft delete
GET    /api/workspaces/:id/goals/:goalId/tree           → full hierarchy (parent chain + children + upstream/downstream)
POST   /api/workspaces/:id/goals/:goalId/infer-downstream → infer funnel cascade from this goal
GET    /api/workspaces/:id/goals/:goalId/current        → compute current value (live, not cached)
GET    /api/workspaces/:id/goals/:goalId/trend          → snapshot time-series for charts

-- Goal Snapshots
GET    /api/workspaces/:id/goal-snapshots               → all snapshots for date range (query: from, to)
POST   /api/workspaces/:id/goal-snapshots/capture        → trigger snapshot capture now
```

### 1G: Wire Goals into Skill Context

This is the critical integration. Skills need goal context to produce goal-aware findings.

In `server/agents/runtime.ts`, where `businessContext` is built before skill execution, add:

```typescript
// In the businessContext builder (before skill execution):

// Existing:
businessContext = {
  business_model: contextData.business_model,
  team_structure: contextData.team_structure,
  goals_and_targets: contextData.goals_and_targets,  // ← narrative, keep this
  definitions: contextData.definitions,
  // ... 
};

// ADD structured goal context:
const activeGoals = await goalService.list(workspaceId, { is_active: true });
const motions = await motionService.list(workspaceId);

// For each goal, compute current value and latest snapshot
const goalContext = await Promise.all(activeGoals.map(async (goal) => {
  const current = await goalService.computeCurrentValue(workspaceId, goal);
  const latestSnapshot = await query(`
    SELECT * FROM goal_snapshots WHERE goal_id = $1 ORDER BY snapshot_date DESC LIMIT 1
  `, [goal.id]);
  const motion = motions.find(m => m.id === goal.motion_id);
  
  return {
    goal_id: goal.id,
    label: goal.label,
    metric_type: goal.metric_type,
    level: goal.level,
    motion: motion ? { type: motion.type, label: motion.label, pipeline_names: motion.pipeline_names } : null,
    target: goal.target_value,
    current: current.current_value,
    attainment_pct: latestSnapshot.rows[0]?.attainment_pct || 0,
    gap: latestSnapshot.rows[0]?.gap || (goal.target_value - current.current_value),
    trajectory: latestSnapshot.rows[0]?.trajectory || 'unknown',
    days_remaining: latestSnapshot.rows[0]?.days_remaining,
    required_run_rate: latestSnapshot.rows[0]?.required_run_rate,
    actual_run_rate: latestSnapshot.rows[0]?.actual_run_rate,
    projected_landing: latestSnapshot.rows[0]?.projected_landing,
    period: `${goal.period_start} to ${goal.period_end}`,
  };
}));

businessContext.structured_goals = goalContext;
businessContext.motions = motions.map(m => ({
  type: m.type,
  label: m.label,
  pipeline_names: m.pipeline_names,
  thresholds: m.thresholds_override,
  funnel: m.funnel_model,
}));
```

Now in Handlebars templates, skills can reference:
```
{{#each structured_goals}}
  {{label}}: {{current}}/{{target}} ({{attainment_pct}}%, {{trajectory}}, {{days_remaining}} days left)
{{/each}}
```

And in Claude synthesis prompts:
```
GOAL CONTEXT:
{{#each structured_goals}}
- {{label}}: ${{current}} of ${{target}} ({{attainment_pct}}% attainment, {{trajectory}}). Gap: ${{gap}}. {{days_remaining}} days remaining. Required weekly run rate: ${{required_run_rate}}, actual: ${{actual_run_rate}}.
{{/each}}
```

---

## Task 2: Finding Persistence & Trending

### 2A: Extend Findings Table

Add columns to the existing findings table for persistence tracking:

```sql
-- 123b_finding_persistence.sql (or include in 123 migration)

-- Track persistence across runs
ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS first_flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS times_flagged INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS escalation_level INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS previous_finding_id UUID REFERENCES findings(id),
  ADD COLUMN IF NOT EXISTS value_when_first_flagged JSONB,
  ADD COLUMN IF NOT EXISTS value_current JSONB,
  ADD COLUMN IF NOT EXISTS trend TEXT CHECK (trend IN ('improving', 'stable', 'worsening', 'new'));

-- The fingerprint is a stable hash that identifies "the same finding" across runs
-- e.g., for a stale deal finding: hash(workspace_id + 'stale_deal' + deal_id)
-- This lets us match Monday's "Acme is stale" with Wednesday's "Acme is still stale"

CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON findings(workspace_id, fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_findings_escalation ON findings(workspace_id, escalation_level) WHERE escalation_level > 0;

-- Set first_flagged_at for existing findings
UPDATE findings SET first_flagged_at = created_at WHERE first_flagged_at IS NULL;
```

### 2B: Finding Persistence Engine

Create `server/findings/persistence-engine.ts`:

```typescript
// server/findings/persistence-engine.ts

/**
 * After each skill run produces new findings, this engine:
 * 1. Computes a fingerprint for each new finding
 * 2. Checks if a matching fingerprint exists from prior runs
 * 3. If yes: increments times_flagged, updates trend, escalates if needed
 * 4. If no: it's a new finding, initialize persistence fields
 * 5. Marks old findings that DIDN'T recur as potentially resolved
 */

export function computeFingerprint(finding: {
  workspace_id: string;
  category: string;
  deal_id?: string;
  account_id?: string;
  owner_email?: string;
  entity_type?: string;
  entity_id?: string;
}): string {
  // Combine the stable attributes into a hash
  // Category + entity gives us "same type of problem on the same entity"
  const parts = [
    finding.workspace_id,
    finding.category,
    finding.deal_id || finding.account_id || finding.owner_email || finding.entity_id || 'workspace',
  ].filter(Boolean);
  
  return createHash('sha256').update(parts.join('|')).digest('hex').substring(0, 32);
}

export async function processFindingPersistence(
  workspaceId: string,
  skillRunId: string,
  skillId: string,
  newFindings: Finding[]
): Promise<void> {
  
  for (const finding of newFindings) {
    const fingerprint = computeFingerprint(finding);
    
    // Look for the most recent prior finding with same fingerprint
    const prior = await query(`
      SELECT id, times_flagged, escalation_level, first_flagged_at, 
             value_when_first_flagged, metric_value as prior_metric_value,
             severity as prior_severity
      FROM findings 
      WHERE workspace_id = $1 AND fingerprint = $2 AND id != $3
      ORDER BY created_at DESC LIMIT 1
    `, [workspaceId, fingerprint, finding.id]);
    
    if (prior.rows.length > 0) {
      const prev = prior.rows[0];
      const timesFlagged = prev.times_flagged + 1;
      
      // Determine trend
      let trend = 'stable';
      if (finding.metric_value && prev.prior_metric_value) {
        const pctChange = (finding.metric_value - prev.prior_metric_value) / prev.prior_metric_value;
        if (pctChange > 0.05) trend = 'worsening';    // Getting worse by >5%
        else if (pctChange < -0.1) trend = 'improving'; // Improving by >10%
      }
      
      // Escalation logic
      let escalationLevel = prev.escalation_level;
      if (timesFlagged >= 4 && escalationLevel < 3) escalationLevel = 3;
      else if (timesFlagged >= 3 && escalationLevel < 2) escalationLevel = 2;
      else if (timesFlagged >= 2 && escalationLevel < 1) escalationLevel = 1;
      
      // Escalate faster if worsening
      if (trend === 'worsening' && escalationLevel < 2) escalationLevel = Math.min(escalationLevel + 1, 3);
      
      // Update the new finding with persistence data
      await query(`
        UPDATE findings SET
          fingerprint = $2,
          first_flagged_at = $3,
          times_flagged = $4,
          escalation_level = $5,
          previous_finding_id = $6,
          value_when_first_flagged = $7,
          value_current = $8,
          trend = $9
        WHERE id = $1
      `, [
        finding.id,
        fingerprint,
        prev.first_flagged_at,
        timesFlagged,
        escalationLevel,
        prev.id,
        prev.value_when_first_flagged || JSON.stringify({ metric_value: prev.prior_metric_value }),
        JSON.stringify({ metric_value: finding.metric_value }),
        trend,
      ]);
    } else {
      // New finding — initialize persistence
      await query(`
        UPDATE findings SET
          fingerprint = $2,
          first_flagged_at = NOW(),
          times_flagged = 1,
          escalation_level = 0,
          trend = 'new'
        WHERE id = $1
      `, [finding.id, fingerprint]);
    }
  }
  
  // Mark findings from prior runs (same skill) that DIDN'T recur
  // This means the issue may have been resolved
  const priorFingerprints = newFindings.map(f => computeFingerprint(f));
  
  await query(`
    UPDATE findings SET
      resolution_method = 'auto_resolved',
      resolved_at = NOW(),
      trend = 'improving'
    WHERE workspace_id = $1 
      AND skill_id = $2
      AND fingerprint IS NOT NULL
      AND fingerprint NOT IN (SELECT unnest($3::text[]))
      AND resolved_at IS NULL
      AND created_at >= NOW() - INTERVAL '7 days'
  `, [workspaceId, skillId, priorFingerprints]);
}
```

### 2C: Wire Persistence into Skill Run Completion

Find where findings are extracted from skill results and inserted into the findings table. After that insertion, call the persistence engine:

```typescript
// After findings are inserted from a skill run:

await processFindingPersistence(workspaceId, skillRunId, skillId, insertedFindings);
```

### 2D: Persistence Context in Synthesis Prompts

When building synthesis prompts, include persistence information:

```typescript
// In the synthesis prompt builder:

const persistentFindings = await query(`
  SELECT message, severity, category, times_flagged, escalation_level, 
         first_flagged_at, trend, entity_name, metric_value,
         value_when_first_flagged
  FROM findings 
  WHERE workspace_id = $1 AND times_flagged > 1 AND resolved_at IS NULL
  ORDER BY escalation_level DESC, times_flagged DESC
  LIMIT 10
`, [workspaceId]);

// Add to synthesis prompt:
const persistenceBlock = persistentFindings.rows.map(f => {
  const daysSinceFirst = daysBetween(new Date(f.first_flagged_at), new Date());
  return `⚠️ RECURRING (${f.times_flagged}x over ${daysSinceFirst} days, ${f.trend}): ${f.message}`;
}).join('\n');

// Include in Claude prompt:
`
RECURRING FINDINGS (flagged multiple times, not yet resolved):
${persistenceBlock || 'None — all prior findings have been resolved or are new.'}

IMPORTANT: For recurring findings, note how long they've persisted and whether they're 
getting worse. If a finding has been flagged 3+ times, recommend escalation.
`
```

---

## Task 3: Cross-Skill Reasoning (Investigation Chains)

### 3A: Investigation Planner

Create `server/investigation/planner.ts`:

The planner takes a question (or an initial set of findings) and decides what sequence of skills to run, with the ability to change the plan based on intermediate results.

```typescript
// server/investigation/planner.ts

export interface InvestigationPlan {
  id: string;
  workspace_id: string;
  question: string;
  goal_context: GoalContext[];  // Active goals relevant to the question
  
  steps: InvestigationStep[];
  current_step: number;
  status: 'planning' | 'executing' | 'synthesizing' | 'complete' | 'error';
  
  max_steps: number;  // Safety limit, default 6
  total_tokens: number;
}

export interface InvestigationStep {
  index: number;
  operator_name: string;
  skill_id: string;
  
  trigger: 'initial' | 'follow_up';
  triggered_by?: {
    step_index: number;
    finding_type: string;
    reasoning: string;  // "Pipeline gap detected → checking gen trend"
  };
  
  // Execution
  status: 'pending' | 'executing' | 'complete' | 'skipped';
  used_cache: boolean;
  result_summary?: string;
  key_findings?: string[];
  
  // Follow-up decision (made after execution)
  follow_up_decision?: 'satisfied' | 'investigate_further';
  follow_up_question?: string;
  follow_up_skill?: string;
}

export async function createInvestigationPlan(
  workspaceId: string,
  question: string,
  options?: {
    maxSteps?: number;
    goalIds?: string[];  // Focus investigation on specific goals
    anchorFindings?: Finding[];  // Start from existing findings
  }
): Promise<InvestigationPlan> {
  
  // 1. Load goal context
  const goals = options?.goalIds 
    ? await Promise.all(options.goalIds.map(id => goalService.getById(id)))
    : await goalService.list(workspaceId, { is_active: true });
  
  // 2. Load available skills and their descriptions
  const skills = await skillRegistry.listForWorkspace(workspaceId);
  
  // 3. Load recent persistent findings for context
  const recentFindings = await query(`
    SELECT skill_id, category, message, times_flagged, trend
    FROM findings WHERE workspace_id = $1 AND resolved_at IS NULL
    ORDER BY severity ASC, created_at DESC LIMIT 15
  `, [workspaceId]);
  
  // 4. Use a lightweight Claude call to plan the investigation
  const planPrompt = `You are planning an investigation to answer this question:
"${question}"

AVAILABLE SKILLS:
${skills.map(s => `- ${s.id}: ${s.description}`).join('\n')}

ACTIVE GOALS:
${goals.filter(Boolean).map(g => `- ${g.label}: ${g.target_value} target, tracking at ${g.trajectory || 'unknown'}`).join('\n')}

RECENT UNRESOLVED FINDINGS:
${recentFindings.rows.map(f => `- [${f.category}] ${f.message} (flagged ${f.times_flagged}x, ${f.trend})`).join('\n')}

${options?.anchorFindings ? `STARTING CONTEXT (already known):\n${options.anchorFindings.map(f => `- ${f.message}`).join('\n')}` : ''}

Plan 2-5 investigation steps. For each step, specify:
1. Which skill to run and why
2. What question this step answers
3. What follow-up might be needed depending on the result

Start with the broadest question (are we on track?) and narrow based on what each step reveals. The first skill should directly address the question. Subsequent skills investigate the "why" behind initial findings.

Respond as JSON:
{
  "steps": [
    {
      "skill_id": "forecast-rollup",
      "reasoning": "Check overall forecast health to answer 'are we hitting the number'",
      "question_answered": "What's the current forecast landing range?",
      "potential_follow_ups": ["If behind, investigate pipeline generation", "If concentrated, check rep distribution"]
    }
  ]
}`;

  const planResult = await callAnthropicAI({
    messages: [{ role: 'user', content: planPrompt }],
    maxTokens: 1000,
    temperature: 0.3,
  });
  
  const plan = parseJsonResponse(planResult);
  
  return {
    id: randomUUID(),
    workspace_id: workspaceId,
    question,
    goal_context: goals.filter(Boolean),
    steps: plan.steps.map((s: any, i: number) => ({
      index: i,
      operator_name: mapSkillToOperator(s.skill_id),
      skill_id: s.skill_id,
      trigger: i === 0 ? 'initial' : 'follow_up',
      triggered_by: i > 0 ? { step_index: i - 1, finding_type: 'tbd', reasoning: s.reasoning } : undefined,
      status: 'pending',
      used_cache: false,
    })),
    current_step: 0,
    status: 'planning',
    max_steps: options?.maxSteps || 6,
    total_tokens: 0,
  };
}
```

### 3B: Investigation Executor

Create `server/investigation/executor.ts`:

```typescript
// server/investigation/executor.ts

export async function executeInvestigation(
  plan: InvestigationPlan,
  callbacks: {
    onStepStart?: (step: InvestigationStep) => void;
    onStepComplete?: (step: InvestigationStep, findings: string[]) => void;
    onFollowUpDecided?: (fromStep: number, newStep: InvestigationStep) => void;
    onSynthesisStart?: () => void;
    onSynthesisChunk?: (text: string) => void;
  }
): Promise<InvestigationResult> {
  
  plan.status = 'executing';
  const allFindings: { step: number; skill_id: string; findings: any[]; summary: string }[] = [];
  
  for (let i = 0; i < plan.steps.length && i < plan.max_steps; i++) {
    const step = plan.steps[i];
    step.status = 'executing';
    callbacks.onStepStart?.(step);
    
    // Execute skill (use cache if fresh, otherwise run live)
    const cached = await query(`
      SELECT id, output_text, result FROM skill_runs
      WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
        AND started_at >= NOW() - INTERVAL '30 minutes'
      ORDER BY started_at DESC LIMIT 1
    `, [plan.workspace_id, step.skill_id]);
    
    let skillResult;
    if (cached.rows.length > 0) {
      skillResult = { output_text: cached.rows[0].output_text, result: cached.rows[0].result };
      step.used_cache = true;
    } else {
      // Run skill live through existing runtime
      const skill = await skillRegistry.get(step.skill_id);
      skillResult = await skillRuntime.executeSkill(skill, plan.workspace_id, {});
      step.used_cache = false;
    }
    
    // Extract key findings from result
    const keyFindings = extractKeyFindings(skillResult);
    step.result_summary = keyFindings.summary;
    step.key_findings = keyFindings.items;
    step.status = 'complete';
    
    allFindings.push({
      step: i,
      skill_id: step.skill_id,
      findings: keyFindings.items,
      summary: keyFindings.summary,
    });
    
    callbacks.onStepComplete?.(step, keyFindings.items);
    
    // FOLLOW-UP DECISION: Does this finding raise a new question?
    // Only if we haven't reached max steps and there are findings worth investigating
    if (i < plan.max_steps - 2 && i === plan.steps.length - 1) {
      // We've finished the planned steps — should we add more?
      const followUp = await decideFollowUp(plan, allFindings, i);
      
      if (followUp && followUp.decision === 'investigate_further') {
        step.follow_up_decision = 'investigate_further';
        step.follow_up_question = followUp.question;
        step.follow_up_skill = followUp.skill_id;
        
        const newStep: InvestigationStep = {
          index: plan.steps.length,
          operator_name: mapSkillToOperator(followUp.skill_id),
          skill_id: followUp.skill_id,
          trigger: 'follow_up',
          triggered_by: {
            step_index: i,
            finding_type: followUp.finding_type,
            reasoning: followUp.reasoning,
          },
          status: 'pending',
          used_cache: false,
        };
        
        plan.steps.push(newStep);
        callbacks.onFollowUpDecided?.(i, newStep);
      } else {
        step.follow_up_decision = 'satisfied';
      }
    }
  }
  
  // SYNTHESIZE with full goal context and persistence
  plan.status = 'synthesizing';
  callbacks.onSynthesisStart?.();
  
  const synthesis = await synthesizeInvestigation(plan, allFindings, callbacks.onSynthesisChunk);
  
  plan.status = 'complete';
  
  return {
    plan,
    synthesis: synthesis.text,
    total_tokens: synthesis.tokens,
    steps_executed: allFindings.length,
    cache_hits: plan.steps.filter(s => s.used_cache).length,
  };
}

async function decideFollowUp(
  plan: InvestigationPlan,
  findings: any[],
  currentStep: number
): Promise<{ decision: string; skill_id?: string; question?: string; reasoning?: string; finding_type?: string } | null> {
  
  // Get the latest step's findings
  const latest = findings[currentStep];
  if (!latest || latest.findings.length === 0) return null;
  
  // Quick pattern match before LLM call (fast path)
  for (const finding of latest.findings) {
    const lower = (finding.message || finding).toLowerCase();
    
    // Pipeline gap → check generation trend
    if (lower.includes('coverage') && lower.includes('below') && !plan.steps.some(s => s.skill_id === 'pipeline-waterfall')) {
      return {
        decision: 'investigate_further',
        skill_id: 'pipeline-waterfall',
        question: 'Is the coverage gap from weak generation or slow close rates?',
        reasoning: 'Coverage is below target — checking pipeline creation vs closure trends',
        finding_type: 'coverage_gap',
      };
    }
    
    // Rep underperformance → check their deals
    if ((lower.includes('behind') || lower.includes('underperform')) && !plan.steps.some(s => s.skill_id === 'rep-scorecard')) {
      return {
        decision: 'investigate_further',
        skill_id: 'rep-scorecard',
        question: 'Which specific reps are behind and why?',
        reasoning: 'Underperformance detected — checking individual rep scorecards',
        finding_type: 'rep_underperformance',
      };
    }
    
    // Stale deals → check conversation intelligence
    if (lower.includes('stale') && !plan.steps.some(s => s.skill_id === 'conversation-intelligence')) {
      return {
        decision: 'investigate_further',
        skill_id: 'conversation-intelligence',
        question: 'Are stale deals showing engagement signals we might be missing?',
        reasoning: 'Stale deals flagged — checking conversation activity for hidden signals',
        finding_type: 'stale_investigation',
      };
    }
    
    // Over-forecasting → check pipeline details
    if (lower.includes('over-forecast') && !plan.steps.some(s => s.skill_id === 'pipeline-hygiene')) {
      return {
        decision: 'investigate_further',
        skill_id: 'pipeline-hygiene',
        question: 'Is the over-forecasting from stale deals or optimistic staging?',
        reasoning: 'Over-forecasting detected — checking pipeline quality for stale or misstaged deals',
        finding_type: 'forecast_accuracy',
      };
    }
  }
  
  // No pattern match → satisfied
  return { decision: 'satisfied' };
}
```

### 3C: Goal-Aware Synthesis

Create `server/investigation/synthesizer.ts`:

```typescript
// server/investigation/synthesizer.ts

export async function synthesizeInvestigation(
  plan: InvestigationPlan,
  allFindings: any[],
  onChunk?: (text: string) => void
): Promise<{ text: string; tokens: number }> {
  
  // Build the synthesis prompt with goal context, persistence, and investigation chain
  
  const goalBlock = plan.goal_context.map(g => 
    `- ${g.label}: $${g.current_value?.toLocaleString() || '?'} of $${g.target_value.toLocaleString()} ` +
    `(${g.attainment_pct || '?'}% attainment, ${g.trajectory || 'unknown'} trajectory, ` +
    `${g.days_remaining || '?'} days remaining)`
  ).join('\n');
  
  const investigationChainBlock = allFindings.map(f => {
    const step = plan.steps[f.step];
    const trigger = step.trigger === 'initial' 
      ? 'Initial investigation' 
      : `Follow-up from step ${step.triggered_by?.step_index + 1}: ${step.triggered_by?.reasoning}`;
    return `Step ${f.step + 1} — ${step.operator_name} (${step.skill_id})${step.used_cache ? ' [cached]' : ''}
Trigger: ${trigger}
Findings: ${f.summary}`;
  }).join('\n\n');
  
  // Load persistence data
  const persistentFindings = await query(`
    SELECT message, times_flagged, trend, first_flagged_at, escalation_level
    FROM findings WHERE workspace_id = $1 AND times_flagged > 1 AND resolved_at IS NULL
    ORDER BY escalation_level DESC LIMIT 8
  `, [plan.workspace_id]);
  
  const persistenceBlock = persistentFindings.rows.length > 0
    ? persistentFindings.rows.map(f => {
        const days = daysBetween(new Date(f.first_flagged_at), new Date());
        return `- [${f.trend.toUpperCase()}, flagged ${f.times_flagged}x over ${days} days] ${f.message}`;
      }).join('\n')
    : 'No recurring unresolved findings.';
  
  const prompt = `You are Pandora, a RevOps intelligence system delivering an investigation summary.

QUESTION: "${plan.question}"

GOAL CONTEXT:
${goalBlock || 'No structured goals configured.'}

INVESTIGATION CHAIN (${allFindings.length} steps executed):
${investigationChainBlock}

RECURRING FINDINGS (previously flagged, not yet resolved):
${persistenceBlock}

SYNTHESIS RULES:
1. Start with THE NUMBER — answer the question directly against the goal. "You're tracking to $X against $Y target."
2. Explain the trajectory — is it improving or declining? Reference the run rate.
3. Walk through the investigation chain — each step revealed something. Connect them causally:
   "Pipeline is short because generation dropped 40%, which traces to Jack creating zero new opportunities..."
4. For recurring findings, note how long they've persisted and escalate: "This is the Nth time I've flagged X. It's getting worse."
5. End with 3-5 specific actions with named people, dollar amounts, and deadlines.
6. Every number should be relative to a goal. Don't say "pipeline is $2.4M" — say "pipeline is $2.4M against $4.2M needed, leaving a $1.8M gap."

VOICE: Direct, specific, actionable. A CRO reading this at 7:42am should know exactly what to worry about and what to do first.

Word budget: 300-500 words.`;

  // Stream the response
  let fullText = '';
  let tokens = 0;
  
  const stream = await streamAnthropicAI({
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1500,
    temperature: 0.4,
  });
  
  for await (const chunk of stream) {
    fullText += chunk.text;
    tokens += chunk.tokens || 0;
    onChunk?.(chunk.text);
  }
  
  return { text: fullText, tokens };
}
```

---

## Task 4: Goal-Aware Question Handling

### 4A: Upgrade the Chat Orchestrator

In `server/chat/orchestrator.ts`, add a new routing path that uses the investigation engine. Insert this AFTER the heuristic router (step 1) and BEFORE the direct question classifier (step 5):

```typescript
// NEW STEP: Goal-aware investigation routing
// Triggers when the question references goals, targets, performance, or forecasting
// AND structured goals exist for this workspace

const goalKeywords = /\b(number|target|goal|quota|hitting|miss|track|forecast|behind|ahead|gap|pace|run rate|attainment|coverage|on track)\b/i;

if (goalKeywords.test(message)) {
  const goals = await goalService.list(workspaceId, { is_active: true });
  
  if (goals.length > 0) {
    // This question is about goal performance — use investigation engine
    const plan = await createInvestigationPlan(workspaceId, message, {
      maxSteps: 5,
    });
    
    // For non-streaming responses (current chat), execute synchronously
    const result = await executeInvestigation(plan, {});
    
    return {
      answer: result.synthesis,
      thread_id: threadId,
      router_decision: 'investigation',
      data_strategy: 'goal_aware_investigation',
      tokens_used: result.total_tokens,
      investigation_steps: result.steps_executed,
      response_id: randomUUID(),
      feedback_enabled: true,
    };
  }
}

// ... existing routing continues below
```

### 4B: For the Streaming Conversation Endpoint (from Assistant View build prompt)

When the streaming conversation endpoint (SSE) from the Assistant View prompt exists, wire the investigation engine into it:

```typescript
// In the SSE conversation handler:

// Instead of hardcoded operator selection, use the investigation planner:
const plan = await createInvestigationPlan(workspaceId, message, { maxSteps: 5 });

// Stream recruitment events from the plan
for (const step of plan.steps) {
  send({
    type: 'recruiting',
    agent_id: step.skill_id,
    agent_name: step.operator_name,
    icon: operatorIcons[step.operator_name],
    color: operatorColors[step.operator_name],
    skills: [step.skill_id],
    task: step.triggered_by?.reasoning || `Investigating: ${plan.question}`,
  });
}

// Execute investigation with streaming callbacks
const result = await executeInvestigation(plan, {
  onStepStart: (step) => {
    send({ type: 'agent_thinking', agent_id: step.skill_id });
  },
  onStepComplete: (step, findings) => {
    send({
      type: 'agent_found',
      agent_id: step.skill_id,
      finding_preview: step.result_summary,
    });
    send({
      type: 'agent_done',
      agent_id: step.skill_id,
      finding: { agent_name: step.operator_name, finding_text: step.result_summary },
    });
  },
  onFollowUpDecided: (fromStep, newStep) => {
    // New operator recruited mid-investigation!
    send({
      type: 'recruiting',
      agent_id: newStep.skill_id,
      agent_name: newStep.operator_name,
      icon: operatorIcons[newStep.operator_name],
      color: operatorColors[newStep.operator_name],
      skills: [newStep.skill_id],
      task: newStep.triggered_by?.reasoning || 'Following up on findings...',
    });
  },
  onSynthesisStart: () => {
    send({ type: 'synthesis_start' });
  },
  onSynthesisChunk: (text) => {
    send({ type: 'synthesis_chunk', text });
  },
});
```

The key UX impact: when the investigation planner decides mid-execution to add a follow-up skill, the user sees a NEW operator chip appear ("Coaching Analyst recruited — checking Jack's activity pattern"). This is *visible reasoning* — the user watches the system think, follow threads, and deepen its investigation in real time. That's what makes it feel genuinely agentic rather than running a fixed pipeline.

---

## API Route Summary

```
-- Revenue Motions
GET/POST/PUT/DELETE  /api/workspaces/:id/motions[/:motionId]
POST                 /api/workspaces/:id/motions/infer

-- Goals  
GET/POST/PUT/DELETE  /api/workspaces/:id/goals[/:goalId]
GET                  /api/workspaces/:id/goals/:goalId/tree
POST                 /api/workspaces/:id/goals/:goalId/infer-downstream
GET                  /api/workspaces/:id/goals/:goalId/current
GET                  /api/workspaces/:id/goals/:goalId/trend

-- Snapshots
GET                  /api/workspaces/:id/goal-snapshots
POST                 /api/workspaces/:id/goal-snapshots/capture
```

## File Structure Summary

```
server/goals/
├── motion-service.ts           # Task 1B: Revenue motion CRUD
├── motion-inference.ts         # Task 1C: Auto-detect motions from CRM
├── goal-service.ts             # Task 1D: Goal CRUD + funnel cascade
├── snapshot-engine.ts          # Task 1E: Daily goal snapshots
└── types.ts                    # Shared types

server/findings/
└── persistence-engine.ts       # Task 2B: Fingerprinting + trending

server/investigation/
├── planner.ts                  # Task 3A: Investigation planning
├── executor.ts                 # Task 3B: Step-by-step execution with follow-ups
└── synthesizer.ts              # Task 3C: Goal-aware synthesis

server/routes/
├── motions.ts                  # Task 1F: Motion API
├── goals.ts                    # Task 1F: Goal API
└── goal-snapshots.ts           # Task 1F: Snapshot API

server/db/migrations/
└── 123_revenue_motions_and_goals.sql  # Task 1A + 2A
```

## Modified Files

```
server/agents/runtime.ts                    # Task 1G: Add structured_goals to businessContext
server/findings/[extraction logic]          # Task 2C: Call persistence engine after finding insertion
server/chat/orchestrator.ts                 # Task 4A: Add investigation routing path
server/db/migrations/ (ALTER sales_reps)    # Task 1A: Add manager_rep_id, is_manager
quota_periods + rep_quotas (ALTER)          # Task 1A: Add motion_id, pipeline_name
```

---

## Validation Checklist

1. **Migration runs** — all new tables created, ALTER columns added to sales_reps, quota_periods, rep_quotas, findings
2. **Motion inference** — run against Frontera workspace → detects pipeline(s), classifies correctly
3. **Motion CRUD** — create, list, update motions via API
4. **Goal creation** — create a $3.5M Q1 bookings goal linked to a new_business motion
5. **Funnel cascade** — call infer-downstream → pipeline goal and opp goal created with correct math
6. **Goal current value** — `/goals/:id/current` returns live sum from deals matching the motion's pipeline
7. **Snapshot capture** — trigger snapshot → row appears in goal_snapshots with trajectory classification
8. **Snapshot trending** — capture 3 snapshots across 3 days → `/goals/:id/trend` shows trajectory
9. **Finding persistence** — run pipeline-hygiene twice → same stale deal gets `times_flagged = 2`, fingerprint matches
10. **Escalation** — run 3 times → escalation_level increases, trend classified
11. **Auto-resolution** — stale deal gets activity → next run doesn't flag it → prior finding marked `auto_resolved`
12. **Investigation planner** — "Are we going to hit the number?" → plan with 2-4 steps, starting with forecast
13. **Investigation executor** — plan executes, follow-up skill added mid-run when pipeline gap detected
14. **Goal-aware synthesis** — synthesis references goal target, gap, trajectory, run rate
15. **Persistence in synthesis** — recurring findings mentioned with "flagged X times over Y days"
16. **Orchestrator routing** — "are we hitting target?" routes to investigation engine, not direct classifier

---

## What NOT to Build

- **Goal creation UI** — API only for now. Goals are created via Excel upload or API. UI comes with Command Center Phase C.
- **Motion management UI** — same, API only. Inference results shown as config suggestions (existing pattern).
- **Automated goal creation from quota upload** — future enhancement. For now, goals and quotas are separate entities that happen to share numbers.
- **Marketing funnel goals** (MQL, leads, visits) — schema supports them but compute logic requires marketing automation connector (not built).
- **NRR / churn computation** — schema supports it but requires renewal pipeline data. Only implement the compute function for workspaces that have renewal motions with deals.
- **Org chart visualization** — manager_rep_id enables hierarchy but the UI is future work.
- **Goal alerting** — "you dropped below on_track" → Slack alert. This is a natural extension but comes after the core is validated.
- **Multi-currency** — goals are single-currency for now. Match the workspace's CRM currency.
