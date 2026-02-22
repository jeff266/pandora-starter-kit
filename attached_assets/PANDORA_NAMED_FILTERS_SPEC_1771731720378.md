# Named Filters: First-Class Tool-Layer Primitives

**Parent specs:** `PANDORA_WORKSPACE_CONFIG_PROMPT_1.md`, `PANDORA_MECE_TOOL_SKILL_PLAYBOOK_MAP.xlsx`, `PANDORA_EVIDENCE_ARCHITECTURE_REFERENCE.md`  
**Affected components:** Tool registry, workspace config, config inference, Agent Builder, skill runtime, evidence contract  
**Triggered by:** Every mid-market company defines business concepts (MQL, Qualified Opp, Expansion Deal) differently — skills that hardcode these definitions break across workspaces  
**Design principle:** Solve it once at the tool layer so skills, agents, Agent Builder users, and marketplace authors never embed customer-specific semantics

---

## The Problem

Pandora's tool layer today provides structural query primitives: `query_deals`, `query_contacts`, `query_conversations`, etc. These accept raw field-level parameters (`stage`, `owner`, `is_open`). Skills compose these tools to produce evidence.

But mid-market companies don't think in raw fields. They think in **business concepts**:

- "MQL" = lifecycle_stage = 'MQL' AND lead_score > 50 AND source != 'competitor_spam'
- "Qualified Opportunity" = stage past Discovery AND has_champion = true AND amount > $10K
- "Expansion Deal" = existing_customer = true AND pipeline = 'Upsell' AND churn_risk < 0.7
- "At-Risk Deal" = days_stale > 14 AND no_activity_30d = true AND single_threaded = true
- "New Logo" = account has zero prior closed-won deals
- "Partner-Sourced" = lead_source IN ('Partner Referral', 'Channel', 'Alliance')
- "Sales-Qualified" = stage >= 'Discovery' AND amount > 0 AND close_date IS NOT NULL

Today, each skill that needs "MQL" would hardcode its own interpretation, or the workspace config would need a bespoke field for every concept. Neither scales.

### Why This Can't Wait

1. **Agent Builder** — users composing custom agents need to say "run Pipeline Hygiene on Expansion Deals only." Without named filters, they'd need to know the raw SQL.
2. **Marketplace** — a methodology pack for "MEDDPICC Pipeline Review" needs to reference "Qualified Opportunity" without knowing how each buyer defines it.
3. **Skill proliferation** — as skill count grows past 20, each one reimplementing "what is an MQL" is a consistency and maintenance nightmare.
4. **Client onboarding** — the first question every client asks: "but our MQL definition is different." Named filters make this a 2-minute config, not a custom build.

---

## Architecture Decision

Named Filters are **workspace-scoped filter definitions** stored in workspace config, **resolved at the tool layer** before query execution, and **recorded in the evidence contract** for auditability.

```
┌─────────────────────────────────────────────────┐
│  Skill / Agent / Agent Builder                  │
│  "Run pipeline hygiene on expansion_deals"      │
│                                                 │
│  query_deals({ named_filter: "expansion_deal"}) │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  Tool Layer: Filter Resolution                  │
│                                                 │
│  1. Look up "expansion_deal" in workspace config│
│  2. Resolve to SQL WHERE clause                 │
│  3. Merge with other parameters                 │
│  4. Execute query                               │
│  5. Tag evidence with filter metadata           │
└─────────────────────────────────────────────────┘
```

Skills never see the raw filter expression. They reference the name. The tool layer resolves it per-workspace. The evidence contract records what was applied.

---

## Schema

### Named Filter Definition

Add to `server/types/workspace-config.ts`:

```typescript
interface NamedFilter {
  id: string;                        // slug: "mql", "expansion_deal", "qualified_opp"
  label: string;                     // "Marketing Qualified Lead"
  description?: string;              // "Contacts that meet our MQL criteria"
  
  // What object(s) this filter applies to
  object: 'deals' | 'contacts' | 'accounts' | 'conversations';
  
  // The filter expression — a structured, composable definition
  // NOT raw SQL — this gets compiled to SQL by the resolver
  conditions: FilterConditionGroup;
  
  // Provenance
  source: 'default' | 'inferred' | 'user_defined' | 'marketplace';
  confidence: number;                // 0.0 - 1.0 (for inferred filters)
  inferred_from?: string;            // "HubSpot lifecycle stage definition" etc.
  
  // Governance
  confirmed: boolean;                // has a human reviewed this?
  created_at: string;
  updated_at: string;
  created_by?: string;               // 'system', 'config_inference', user email, marketplace pack ID
  
  // Usage tracking (for marketplace analytics and dead filter detection)
  last_used_at?: string;
  usage_count?: number;
}

// Structured filter conditions — NOT raw SQL
// This is what makes filters portable across CRM types and safe from injection

interface FilterConditionGroup {
  operator: 'AND' | 'OR';
  conditions: (FilterCondition | FilterConditionGroup)[];  // recursive nesting
}

interface FilterCondition {
  field: string;                     // "stage_normalized", "custom_fields->>'lead_score'", "amount"
  operator: FilterOperator;
  value: FilterValue;
  
  // For cross-object conditions (e.g., "account has zero closed-won deals")
  // These get compiled to EXISTS subqueries
  cross_object?: {
    target_object: 'deals' | 'contacts' | 'accounts';
    join_field: string;              // "account_id", "deal_id"
    aggregate?: 'count' | 'sum' | 'max' | 'min';
  };
}

type FilterOperator = 
  | 'eq' | 'neq'                     // equals, not equals
  | 'gt' | 'gte' | 'lt' | 'lte'     // numeric comparisons
  | 'in' | 'not_in'                  // set membership
  | 'contains' | 'not_contains'      // string contains
  | 'is_null' | 'is_not_null'        // null checks
  | 'is_true' | 'is_false'           // boolean
  | 'between'                        // range (value is [min, max])
  | 'relative_date'                  // "last_30_days", "this_quarter", etc.
  ;

type FilterValue = string | number | boolean | string[] | number[] | [number, number] | RelativeDateValue;

interface RelativeDateValue {
  type: 'relative';
  unit: 'days' | 'weeks' | 'months' | 'quarters' | 'years';
  offset: number;                    // negative = past, positive = future
  anchor?: 'now' | 'period_start' | 'period_end';
}
```

### Add to WorkspaceConfig

```typescript
interface WorkspaceConfig {
  // ... existing fields ...
  
  named_filters: NamedFilter[];
  
  // ... rest of config ...
}
```

---

## Filter Resolver

Create `server/tools/filter-resolver.ts`:

This is the single point where named filters get compiled to SQL. No other code path generates SQL from filter definitions.

```typescript
export class FilterResolver {
  
  /**
   * Resolve a named filter to a SQL WHERE clause fragment.
   * Returns the clause AND metadata for evidence recording.
   */
  async resolve(
    workspaceId: string, 
    filterIdOrInline: string | FilterConditionGroup,
    options?: {
      table_alias?: string;          // default: no alias
      parameter_offset?: number;     // for parameterized queries ($1, $2...)
    }
  ): Promise<FilterResolution> {
    
    let filter: NamedFilter | null = null;
    let conditions: FilterConditionGroup;
    
    if (typeof filterIdOrInline === 'string') {
      // Named filter lookup
      const config = await configLoader.getConfig(workspaceId);
      filter = config.named_filters.find(f => f.id === filterIdOrInline);
      
      if (!filter) {
        throw new FilterNotFoundError(
          `Named filter "${filterIdOrInline}" not found in workspace config. ` +
          `Available filters: ${config.named_filters.map(f => f.id).join(', ')}`
        );
      }
      
      conditions = filter.conditions;
      
      // Update usage tracking (fire-and-forget)
      this.recordUsage(workspaceId, filter.id);
    } else {
      // Inline filter (for ad-hoc Agent Builder queries)
      conditions = filterIdOrInline;
    }
    
    const { sql, params } = this.compileToSQL(conditions, options);
    
    return {
      sql,                           // "AND stage_normalized IN ($1, $2) AND amount > $3"
      params,                        // ['discovery', 'proposal', 10000]
      
      // Evidence metadata
      filter_metadata: {
        filter_id: filter?.id || '_inline',
        filter_label: filter?.label || 'Inline filter',
        filter_source: filter?.source || 'user_defined',
        confidence: filter?.confidence ?? 1.0,
        confirmed: filter?.confirmed ?? false,
        conditions_summary: this.summarizeConditions(conditions),  // human-readable
      }
    };
  }
  
  /**
   * Compile structured conditions to SQL.
   * Handles nested AND/OR groups, cross-object subqueries, relative dates.
   */
  private compileToSQL(
    group: FilterConditionGroup, 
    options?: { table_alias?: string; parameter_offset?: number }
  ): { sql: string; params: any[] } {
    const alias = options?.table_alias ? `${options.table_alias}.` : '';
    let paramIndex = options?.parameter_offset ?? 1;
    const params: any[] = [];
    
    const parts: string[] = [];
    
    for (const condition of group.conditions) {
      if ('operator' in condition && 'conditions' in condition) {
        // Nested group — recurse
        const nested = this.compileToSQL(condition, { 
          table_alias: options?.table_alias, 
          parameter_offset: paramIndex 
        });
        parts.push(`(${nested.sql})`);
        params.push(...nested.params);
        paramIndex += nested.params.length;
      } else {
        // Leaf condition
        const leaf = condition as FilterCondition;
        const { sql: leafSql, leafParams } = this.compileCondition(
          leaf, alias, paramIndex
        );
        parts.push(leafSql);
        params.push(...leafParams);
        paramIndex += leafParams.length;
      }
    }
    
    const joiner = group.operator === 'AND' ? ' AND ' : ' OR ';
    return { sql: parts.join(joiner), params };
  }
  
  /**
   * Compile a single condition to SQL.
   */
  private compileCondition(
    condition: FilterCondition,
    alias: string,
    paramIndex: number
  ): { sql: string; leafParams: any[] } {
    const field = `${alias}${condition.field}`;
    
    // Handle cross-object conditions (EXISTS subqueries)
    if (condition.cross_object) {
      return this.compileCrossObjectCondition(condition, alias, paramIndex);
    }
    
    // Handle relative dates
    if (this.isRelativeDate(condition.value)) {
      return this.compileRelativeDate(condition, field, paramIndex);
    }
    
    // Standard operators
    switch (condition.operator) {
      case 'eq':
        return { sql: `${field} = $${paramIndex}`, leafParams: [condition.value] };
      case 'neq':
        return { sql: `${field} != $${paramIndex}`, leafParams: [condition.value] };
      case 'gt':
        return { sql: `${field} > $${paramIndex}`, leafParams: [condition.value] };
      case 'gte':
        return { sql: `${field} >= $${paramIndex}`, leafParams: [condition.value] };
      case 'lt':
        return { sql: `${field} < $${paramIndex}`, leafParams: [condition.value] };
      case 'lte':
        return { sql: `${field} <= $${paramIndex}`, leafParams: [condition.value] };
      case 'in':
        const vals = condition.value as any[];
        const placeholders = vals.map((_, i) => `$${paramIndex + i}`).join(', ');
        return { sql: `${field} IN (${placeholders})`, leafParams: vals };
      case 'not_in':
        const nvals = condition.value as any[];
        const nplaceholders = nvals.map((_, i) => `$${paramIndex + i}`).join(', ');
        return { sql: `${field} NOT IN (${nplaceholders})`, leafParams: nvals };
      case 'contains':
        return { sql: `${field} ILIKE $${paramIndex}`, leafParams: [`%${condition.value}%`] };
      case 'is_null':
        return { sql: `${field} IS NULL`, leafParams: [] };
      case 'is_not_null':
        return { sql: `${field} IS NOT NULL`, leafParams: [] };
      case 'between':
        const [min, max] = condition.value as [number, number];
        return { sql: `${field} BETWEEN $${paramIndex} AND $${paramIndex + 1}`, leafParams: [min, max] };
      default:
        throw new Error(`Unknown filter operator: ${condition.operator}`);
    }
  }
  
  /**
   * Compile cross-object conditions to EXISTS subqueries.
   * Example: "account has zero closed-won deals" becomes:
   *   NOT EXISTS (SELECT 1 FROM deals WHERE deals.account_id = accounts.id AND is_closed_won = true)
   */
  private compileCrossObjectCondition(
    condition: FilterCondition,
    alias: string,
    paramIndex: number
  ): { sql: string; leafParams: any[] } {
    const co = condition.cross_object!;
    const subAlias = `_sub_${co.target_object}`;
    
    if (co.aggregate === 'count' && condition.operator === 'eq' && condition.value === 0) {
      // Special case: count = 0 → NOT EXISTS
      return {
        sql: `NOT EXISTS (SELECT 1 FROM ${co.target_object} ${subAlias} WHERE ${subAlias}.${co.join_field} = ${alias}id AND ${subAlias}.workspace_id = ${alias}workspace_id)`,
        leafParams: []
      };
    }
    
    // General case: aggregate subquery
    const aggFn = co.aggregate || 'count';
    const aggField = condition.field === '*' ? '*' : `${subAlias}.${condition.field}`;
    
    return {
      sql: `(SELECT ${aggFn === 'count' ? `COUNT(*)` : `${aggFn.toUpperCase()}(${aggField})`} FROM ${co.target_object} ${subAlias} WHERE ${subAlias}.${co.join_field} = ${alias}id AND ${subAlias}.workspace_id = ${alias}workspace_id) ${this.operatorToSQL(condition.operator)} $${paramIndex}`,
      leafParams: [condition.value]
    };
  }
  
  /**
   * Generate human-readable summary for evidence recording.
   */
  summarizeConditions(group: FilterConditionGroup): string {
    const parts = group.conditions.map(c => {
      if ('conditions' in c) return `(${this.summarizeConditions(c as FilterConditionGroup)})`;
      const leaf = c as FilterCondition;
      return `${leaf.field} ${leaf.operator} ${JSON.stringify(leaf.value)}`;
    });
    return parts.join(` ${group.operator} `);
  }
}

// Return type
interface FilterResolution {
  sql: string;
  params: any[];
  filter_metadata: {
    filter_id: string;
    filter_label: string;
    filter_source: string;
    confidence: number;
    confirmed: boolean;
    conditions_summary: string;
  };
}
```

---

## Tool Registry Integration

Modify every query tool to accept an optional `named_filter` parameter. The tool resolves the filter before executing.

### Updated Tool Definition Pattern

```typescript
// In server/skills/tool-definitions.ts

{
  name: 'query_deals',
  description: 'Parameterized deal query with all filter combos. Supports named filters for business concept scoping.',
  parameters: {
    // ... existing parameters ...
    named_filter: {
      type: 'string',
      description: 'Named filter ID from workspace config (e.g., "mql", "expansion_deal", "qualified_opp"). Resolves to workspace-specific filter criteria.',
      required: false,
    },
    named_filters: {
      type: 'string[]',
      description: 'Multiple named filter IDs to combine with AND. Use when scoping requires multiple concepts (e.g., ["expansion_deal", "at_risk"]).',
      required: false,
    },
  },
  execute: async (params, context) => {
    const { workspaceId } = context;
    const resolver = new FilterResolver();
    
    // Resolve named filters
    let filterSQL = '';
    let filterParams: any[] = [];
    let filterMetadata: FilterResolution['filter_metadata'][] = [];
    
    const filterIds = params.named_filters || (params.named_filter ? [params.named_filter] : []);
    
    for (const filterId of filterIds) {
      const resolution = await resolver.resolve(workspaceId, filterId, {
        table_alias: 'd',
        parameter_offset: filterParams.length + 1,  // offset past existing params
      });
      filterSQL += ` AND (${resolution.sql})`;
      filterParams.push(...resolution.params);
      filterMetadata.push(resolution.filter_metadata);
    }
    
    // Merge with standard query parameters
    const query = buildDealQuery({
      ...params,
      additionalWhere: filterSQL,
      additionalParams: filterParams,
    });
    
    const result = await db.query(query.sql, query.params);
    
    return {
      ...formatResult(result),
      _applied_filters: filterMetadata,    // evidence breadcrumb
    };
  }
}
```

Apply the same pattern to `query_contacts`, `query_accounts`, `query_conversations`, and `compute_metric`.

---

## Evidence Contract Integration

When a skill uses a named filter, the evidence must record it. This is critical for trust — users need to see "this analysis was scoped to Expansion Deals, which you define as..."

### In SkillEvidence.parameters

```typescript
interface SkillEvidence {
  // ... existing fields ...
  
  parameters: {
    // ... existing parameters ...
    
    applied_filters?: {
      filter_id: string;
      filter_label: string;
      conditions_summary: string;    // "pipeline IN ('Upsell', 'Cross-sell') AND existing_customer = true"
      source: string;                // "inferred from HubSpot pipeline configuration"
      confidence: number;
      confirmed: boolean;
    }[];
  };
}
```

### In Claude Synthesis Prompt

When filters are applied, append to the synthesis context:

```
SCOPE NOTICE:
This analysis is scoped to "Expansion Deals" — defined as:
  pipeline IN ('Upsell', 'Cross-sell') AND existing_customer = true
  Source: inferred from HubSpot pipeline configuration (confidence: 0.85, NOT YET CONFIRMED by admin)

If this definition seems wrong, flag it in your synthesis.
```

This gives Claude the context to question bad filter definitions — e.g., "Note: The current Expansion Deal definition may be excluding partner-sourced upsells. Consider reviewing this filter."

---

## Config Inference: Auto-Detecting Named Filters

The workspace config inference engine (Prompt 2) already extracts lifecycle definitions from CRM schemas. Extend it to produce named filters.

### Source: HubSpot Lifecycle Stages

```typescript
// HubSpot provides lifecycle stage definitions natively
// GET /crm/v3/properties/contacts/lifecycle_stage

// Each lifecycle stage option becomes a candidate named filter:
{
  id: 'mql',
  label: 'Marketing Qualified Lead',
  object: 'contacts',
  conditions: {
    operator: 'AND',
    conditions: [
      { field: 'lifecycle_stage', operator: 'eq', value: 'marketingqualifiedlead' }
    ]
  },
  source: 'inferred',
  confidence: 0.9,
  inferred_from: 'HubSpot lifecycle stage property definition',
  confirmed: false,
}
```

### Source: HubSpot Smart Lists

```typescript
// GET /contacts/v1/lists?count=50
// Lists named "MQL", "SQL", "Target Accounts" contain filter criteria
// that literally define the company's business concepts

// A smart list with filters:
//   lifecycle_stage = MQL AND lead_score > 50 AND hs_analytics_source != 'OFFLINE'
// Becomes:
{
  id: 'mql',
  label: 'MQL (from HubSpot smart list)',
  object: 'contacts',
  conditions: {
    operator: 'AND',
    conditions: [
      { field: 'lifecycle_stage', operator: 'eq', value: 'marketingqualifiedlead' },
      { field: "custom_fields->>'lead_score'", operator: 'gt', value: 50 },
      { field: "custom_fields->>'hs_analytics_source'", operator: 'neq', value: 'OFFLINE' },
    ]
  },
  source: 'inferred',
  confidence: 0.85,
  inferred_from: 'HubSpot smart list "MQLs for Nurture"',
  confirmed: false,
}
```

### Source: Salesforce Record Types + Validation Rules

```typescript
// Record types → pipeline-scoped filters
// GET /services/data/v61.0/sobjects/Opportunity/describe
// recordTypeInfos: [{ name: 'New Business' }, { name: 'Renewal' }, { name: 'Expansion' }]

{
  id: 'new_business_deal',
  label: 'New Business Deal',
  object: 'deals',
  conditions: {
    operator: 'AND',
    conditions: [
      { field: "custom_fields->>'record_type'", operator: 'eq', value: 'New Business' }
    ]
  },
  source: 'inferred',
  confidence: 1.0,  // schema fact
  inferred_from: 'Salesforce Opportunity record type',
  confirmed: false,
}

// Validation rules → stage-conditional filters
// "Amount required when Stage = Proposal" reveals that Proposal is a 
// qualification gate — this implies a "Qualified Opportunity" definition:
{
  id: 'qualified_opportunity',
  label: 'Qualified Opportunity',
  object: 'deals',
  conditions: {
    operator: 'AND',
    conditions: [
      { field: 'stage_order', operator: 'gte', value: 3 },  // past early stages
      { field: 'amount', operator: 'is_not_null', value: true },
      { field: 'close_date', operator: 'is_not_null', value: true },
    ]
  },
  source: 'inferred',
  confidence: 0.7,
  inferred_from: 'Salesforce validation rules require Amount and Close Date at Proposal stage',
  confirmed: false,
}
```

### Source: CRM Report Filters (Salesforce)

```typescript
// Existing logic from workspace config Prompt 2, Source 5:
// Report filters like "Record Type = New Business AND Stage != Unqualified AND Amount > 0"
// These are business concept definitions hiding in plain sight.

// A report filtered to "Pipeline = New Business, Stage >= Qualification, Amount > 0"
// reveals the company's working definition of "Active Qualified Pipeline":
{
  id: 'active_qualified_pipeline',
  label: 'Active Qualified Pipeline',
  object: 'deals',
  conditions: {
    operator: 'AND',
    conditions: [
      { field: "custom_fields->>'record_type'", operator: 'eq', value: 'New Business' },
      { field: 'stage_order', operator: 'gte', value: 2 },
      { field: 'amount', operator: 'gt', value: 0 },
      { field: 'is_open', operator: 'is_true', value: true },
    ]
  },
  source: 'inferred',
  confidence: 0.75,
  inferred_from: 'Salesforce report "Q1 Qualified Pipeline" filter criteria',
  confirmed: false,
}
```

---

## Default Named Filters

Every workspace gets a starter set. These are overridable — the config inference engine replaces them with CRM-specific versions when available.

```typescript
const DEFAULT_NAMED_FILTERS: NamedFilter[] = [
  {
    id: 'open_pipeline',
    label: 'Open Pipeline',
    object: 'deals',
    conditions: {
      operator: 'AND',
      conditions: [
        { field: 'is_open', operator: 'is_true', value: true },
        { field: 'stage_normalized', operator: 'not_in', value: ['closed_won', 'closed_lost'] },
      ]
    },
    source: 'default',
    confidence: 1.0,
    confirmed: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'new_logo',
    label: 'New Logo Deal',
    description: 'Deals at accounts with no prior closed-won deals',
    object: 'deals',
    conditions: {
      operator: 'AND',
      conditions: [
        { field: 'is_open', operator: 'is_true', value: true },
        { 
          field: '*', 
          operator: 'eq', 
          value: 0,
          cross_object: {
            target_object: 'deals',
            join_field: 'account_id',
            aggregate: 'count',
          }
          // Note: this needs refinement — should filter cross-object to is_closed_won = true
        },
      ]
    },
    source: 'default',
    confidence: 0.8,
    confirmed: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'stale_deal',
    label: 'Stale Deal',
    description: 'Deals with no activity beyond the workspace stale threshold',
    object: 'deals',
    conditions: {
      operator: 'AND',
      conditions: [
        { field: 'is_open', operator: 'is_true', value: true },
        { field: 'days_since_last_activity', operator: 'gte', value: 14 },
        // Note: 14 is default — resolver should pull from workspace threshold config
      ]
    },
    source: 'default',
    confidence: 0.8,
    confirmed: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];
```

---

## Agent Builder Integration

In the Agent Builder UI, named filters appear as a dropdown when configuring skill scope:

```
┌──────────────────────────────────────────────────┐
│ Agent Configuration: Weekly Expansion Review      │
│                                                  │
│ Skills:                                          │
│   ☑ Pipeline Hygiene                             │
│   ☑ Pipeline Coverage                            │
│   ☑ Deal Risk Review                             │
│                                                  │
│ Scope:                                           │
│   Filter: [▼ Expansion Deal          ]           │
│           [ + Add another filter     ]           │
│                                                  │
│   ℹ️ "Expansion Deal" = pipeline IN              │
│     ('Upsell', 'Cross-sell') AND                 │
│     existing_customer = true                     │
│   Source: Inferred from HubSpot pipelines        │
│   ⚠️ Not yet confirmed by admin                  │
│                                                  │
│ Schedule: Weekly, Monday 8am                     │
│ Channel: #expansion-team Slack                   │
└──────────────────────────────────────────────────┘
```

The agent definition stores the filter reference, not the filter expression:

```typescript
// In agent definition (agents-v2 table)
{
  // ... agent config ...
  scope: {
    named_filters: ['expansion_deal'],    // resolved at runtime
  }
}
```

At execution time, the agent passes the filter to each skill, which passes it to each tool. Resolution happens at the tool layer. If the customer changes their Expansion Deal definition, every agent and skill that references it immediately picks up the new definition.

---

## Marketplace Integration

Methodology packs can declare **filter requirements** — named filters that must exist in the workspace for the pack to work:

```typescript
// In a marketplace methodology pack manifest
{
  pack_id: 'meddpicc_pipeline_review',
  required_filters: [
    {
      id: 'qualified_opportunity',
      description: 'Deals that have passed initial qualification',
      fallback: {
        // If the workspace doesn't have this filter defined, use this default
        conditions: {
          operator: 'AND',
          conditions: [
            { field: 'stage_order', operator: 'gte', value: 2 },
            { field: 'amount', operator: 'gt', value: 0 },
          ]
        }
      }
    },
  ],
  skills: [/* ... */],
  agents: [/* ... */],
}
```

On pack install, the system checks if required filters exist. If not, it creates them from the fallback definition with `source: 'marketplace'` and `confirmed: false`, prompting the admin to review.

---

## API Endpoints

### Named Filter CRUD

```
GET    /api/workspaces/:id/filters
  Returns all named filters for the workspace.
  Query params: ?object=deals (filter by object type)
  
GET    /api/workspaces/:id/filters/:filterId
  Returns a single filter with usage stats.

POST   /api/workspaces/:id/filters
  Create a new named filter.
  Body: { id, label, description?, object, conditions }
  Sets source = 'user_defined', confirmed = true.

PUT    /api/workspaces/:id/filters/:filterId
  Update filter conditions or metadata.
  If the filter was inferred, set source = 'user_defined' on edit.

DELETE /api/workspaces/:id/filters/:filterId
  Delete a named filter.
  Returns 409 if the filter is referenced by active agents.

POST   /api/workspaces/:id/filters/:filterId/confirm
  Mark an inferred filter as confirmed without changing its definition.

POST   /api/workspaces/:id/filters/:filterId/preview
  Dry-run the filter and return matching record count + sample records.
  Response: { count, sample_records: [...first 5], sql_preview }
  Essential for "does this filter definition actually match what I expect?"
```

### Filter Resolution Endpoint (for Agent Builder UI)

```
POST   /api/workspaces/:id/filters/resolve
  Body: { filter_ids: ['expansion_deal', 'at_risk'] }
  Returns: { 
    sql_preview: "pipeline IN ('Upsell') AND days_stale > 14",
    record_count: 23,
    sample: [...],
    metadata: [...]
  }
```

---

## Migration

```sql
-- Named filters are stored within the workspace_config JSON in context_layer.
-- No new table needed — they live alongside pipelines, teams, thresholds.
-- 
-- However, add an index for the filter usage tracking:

CREATE TABLE IF NOT EXISTS filter_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  filter_id TEXT NOT NULL,
  used_by TEXT NOT NULL,             -- skill_id or agent_id
  used_at TIMESTAMPTZ DEFAULT NOW(),
  record_count INTEGER               -- how many records matched
);

CREATE INDEX idx_filter_usage_workspace 
  ON filter_usage_log(workspace_id, filter_id, used_at DESC);

-- Cleanup: keep 90 days of usage data
-- (add to nightly maintenance cron)
```

---

## Implementation Sequence

```
Phase 1 — Schema + Resolver (Claude Code, ~3-4 hours)
  1. Add NamedFilter types to workspace-config.ts
  2. Build FilterResolver with SQL compilation
  3. Add default named filters to config factory
  4. Unit test resolver against all operator types
  5. Test cross-object conditions (EXISTS subqueries)

Phase 2 — Tool Integration (Claude Code, ~2-3 hours)
  1. Add named_filter parameter to query_deals
  2. Add named_filter parameter to query_contacts, query_accounts, query_conversations
  3. Add named_filter parameter to compute_metric
  4. Wire _applied_filters into tool output for evidence
  5. Test with hardcoded filter against Frontera data

Phase 3 — Config Inference (Claude Code, ~3-4 hours)
  1. Extend HubSpot lifecycle stage extraction to emit named filters
  2. Extend HubSpot smart list extraction to emit named filters
  3. Extend Salesforce record type extraction to emit named filters
  4. Extend Salesforce validation rule extraction to emit named filters
  5. Extend CRM report filter extraction to emit named filters
  6. Run against all 4 client workspaces, log inferred filters

Phase 4 — API + Evidence (Replit, ~2-3 hours)
  1. Build CRUD endpoints
  2. Build preview/resolve endpoints
  3. Wire filter metadata into evidence contract
  4. Add filter context to Claude synthesis prompts

Phase 5 — Agent Builder UI (Replit, ~2-3 hours)
  1. Add filter scope dropdown to agent configuration
  2. Show filter definition + confidence + source inline
  3. Add "confirm" action for unconfirmed filters
  4. Wire agent scope.named_filters to skill execution
```

---

## Validation Criteria

After implementation, verify with production workspaces:

| Workspace | Expected Inferred Filters |
|---|---|
| Frontera (HubSpot) | MQL (lifecycle stage), SQL (lifecycle stage), pipeline-specific deal types |
| GrowthBook (HubSpot) | Similar lifecycle-based filters |
| Imubit (Salesforce) | Record type filters (New Business, etc.), validation-rule-derived qualified opp |
| GrowthX (HubSpot) | Similar lifecycle-based filters |

**Test: Filter produces correct SQL**
```
POST /api/workspaces/:id/filters/mql/preview
→ Should return contacts matching the workspace's MQL definition
→ SQL preview should be a valid, parameterized query
→ Record count should match a manual SQL query
```

**Test: Skill uses filter correctly**
```
Run Pipeline Hygiene with scope = "expansion_deal"
→ Evidence.parameters.applied_filters should contain the filter metadata
→ Only expansion deals should appear in evaluated_records
→ Claude synthesis should reference the scope
```

**Test: Agent Builder references filter**
```
Create agent with scope.named_filters = ['new_logo']
Execute agent
→ All composed skills should only see new logo deals
→ Evidence chain should show filter applied at tool layer
```

---

## What NOT to Build Yet

- **Visual filter builder UI** — Phase 5 uses a dropdown of existing filters. A drag-and-drop condition builder (field + operator + value) is a Command Center Phase C feature.
- **Filter versioning** — when a filter definition changes, old evidence still references the old version. For now, the evidence records the `conditions_summary` at execution time. Versioned filter history is future.
- **Filter dependencies** — a filter that references another filter ("At-Risk Expansion Deal" = expansion_deal AND at_risk). Composition via `named_filters: ['expansion_deal', 'at_risk']` with AND semantics is sufficient for now.
- **Filter-level permissions** — all workspace users can see and use all filters. Role-based filter visibility is an enterprise feature.
- **Dynamic filter values** — filters with values that change based on context (e.g., "this quarter's pipeline" where "this quarter" is dynamic). The `relative_date` operator handles time-based dynamism; other dynamic values are future.
