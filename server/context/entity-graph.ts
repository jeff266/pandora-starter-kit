/**
 * PANDORA_ENTITY_GRAPH
 *
 * Declarative map of every table and relationship that Pandora can reason about.
 * Used by the planning step (iteration 0) to sequence tool calls and prevent the
 * most common model errors:
 *   - Querying deal columns that live in skill_runs (forecast_category, health_score)
 *   - Missing temporal joins when diagnosing stalls
 *   - Skipping skill_run reads and re-computing what's already been analyzed
 */

export interface EntityGraph {
  entities: Record<string, EntityDef>;
  query_routing: Record<string, string[]>;
  injection: InjectionRules;
}

export interface EntityDef {
  table: string;
  primary_key: string;
  workspace_scoped?: boolean;
  crm_key?: string;
  fields?: {
    native?: string[];
    never_on_deal?: string[];
  };
  computed_fields?: Record<string, string[]>;
  relationships?: Record<string, RelationshipDef>;
  access_rule?: string;
  order?: string;
  derived_signals?: string[];
  temporal_join?: { pattern: string; joinable_with?: string[] };
  sources?: string[];
  link_confidence?: string[];
  pandora_principle?: string;
  roles?: string[];
  scoping_rule?: string;
  sync?: string;
}

export interface RelationshipDef {
  table?: string;
  via: string;
  type: 'one_to_many' | 'many_to_one' | 'inferred' | 'derived';
  order?: string;
  latest_per_skill?: boolean;
  nullable?: boolean;
}

export interface InjectionRules {
  full_graph_threshold: string;
  single_entity_skip: string;
  max_tokens_in_prompt: string;
  scoped_variant_triggers: string[];
}

export const PANDORA_ENTITY_GRAPH: EntityGraph = {

  entities: {

    deal: {
      table: 'deals',
      primary_key: 'id',
      crm_key: 'crm_deal_id',
      workspace_scoped: true,
      fields: {
        native: ['name', 'amount', 'stage', 'close_date', 'owner_id',
                 'pipeline_id', 'days_in_stage', 'created_date'],
        never_on_deal: ['forecast_category', 'prospect_score', 'health_score',
                        'behavioral_path', 'icp_fit_score'],
        // ↑ Critical: these live in skill_runs.result_data, not on the deal record
      },
      relationships: {
        stage_history:   { table: 'deal_stage_history',  via: 'deal_id',     type: 'one_to_many', order: 'changed_at ASC' },
        conversations:   { table: 'conversations',        via: 'crm_deal_id', type: 'one_to_many', order: 'started_at DESC' },
        contacts:        { table: 'contacts',             via: 'crm_deal_id', type: 'one_to_many' },
        skill_findings:  { table: 'skill_runs',           via: 'deal_id',     type: 'one_to_many', latest_per_skill: true },
        owner:           { table: 'users',                via: 'owner_id',    type: 'many_to_one' },
        calendar_events: { table: 'calendar_events',      via: 'deal_id',     type: 'one_to_many', order: 'start_time ASC' },
      },
    },

    skill_run: {
      table: 'skill_runs',
      primary_key: 'id',
      workspace_scoped: true,
      access_rule: 'READ_LATEST_ONLY — never re-execute on user query. Always SELECT WHERE skill_name = $skill AND workspace_id = $ws ORDER BY created_at DESC LIMIT 1',
      computed_fields: {
        deal_level:       ['forecast_category', 'prospect_score', 'health_score',
                           'behavioral_winning_path', 'days_stale', 'risk_flags'],
        pipeline_level:   ['coverage_ratio', 'weighted_forecast', 'pandora_weighted',
                           'stage_conversion_rates', 'waterfall_adjustments'],
        rep_level:        ['attainment_pct', 'pipeline_multiple', 'activity_score',
                           'avg_days_to_close', 'win_rate_90d'],
        workspace_level:  ['icp_fit_distribution', 'competitor_mentions',
                           'persona_patterns', 'quarter_health'],
      },
      relationships: {
        deal:      { via: 'deal_id',      type: 'many_to_one', nullable: true },
        workspace: { via: 'workspace_id', type: 'many_to_one' },
      },
    },

    stage_history: {
      table: 'deal_stage_history',
      primary_key: 'id',
      workspace_scoped: true,
      order: 'changed_at ASC',
      derived_signals: ['days_in_stage', 'regression_detected', 'velocity_vs_baseline',
                        'gap_at_stage', 'stage_entered_at', 'stage_exited_at'],
      temporal_join: {
        pattern: 'event_date BETWEEN stage_entered_at AND COALESCE(stage_exited_at, NOW())',
        joinable_with: ['conversations', 'calendar_events'],
      },
      relationships: {
        deal: { via: 'deal_id', type: 'many_to_one' },
      },
    },

    conversation: {
      table: 'conversations',
      primary_key: 'id',
      workspace_scoped: true,
      sources: ['gong', 'fireflies', 'fathom'],
      link_confidence: ['confirmed', 'inferred', 'unlinked'],
      pandora_principle: 'Surface WHAT HAPPENED BECAUSE OF a call, not what was said in it. Never recreate what Gong/Fireflies do natively.',
      fields: { native: ['title', 'started_at', 'duration_seconds', 'participants',
               'summary', 'link_confidence', 'crm_deal_id'] },
      temporal_join: {
        pattern: 'conversations.started_at BETWEEN stage_history.changed_at AND COALESCE(next_stage.changed_at, NOW())',
      },
      relationships: {
        deal:          { via: 'crm_deal_id', type: 'many_to_one', nullable: true },
        stage_context: { via: 'temporal_join', type: 'derived' },
      },
    },

    contact: {
      table: 'contacts',
      primary_key: 'id',
      workspace_scoped: true,
      fields: { native: ['name', 'title', 'email', 'seniority', 'buying_role',
               'last_activity_date', 'crm_deal_id'] },
      relationships: {
        deal:          { via: 'crm_deal_id', type: 'many_to_one' },
        conversations: { via: 'email_match OR domain_match', type: 'inferred' },
      },
    },

    calendar_event: {
      table: 'calendar_events',
      primary_key: 'id',
      workspace_scoped: true,
      sync: '15-minute background sync via Google Calendar OAuth (workspace-level)',
      fields: { native: ['title', 'start_time', 'end_time', 'attendees', 'deal_id', 'status'] },
      relationships: {
        deal:          { via: 'deal_id',      type: 'many_to_one', nullable: true },
        stage_context: { via: 'temporal_join', type: 'derived' },
      },
    },

    user: {
      table: 'users',
      primary_key: 'id',
      roles: ['admin', 'rep'],
      scoping_rule: 'rep → own deals only (deals.owner_id = current_user.id). admin → full workspace.',
      relationships: {
        deals:      { via: 'owner_id',     type: 'one_to_many' },
        agent_runs: { via: 'triggered_by', type: 'one_to_many' },
      },
    },

    agent_run: {
      table: 'agent_runs',
      primary_key: 'id',
      workspace_scoped: true,
      relationships: {
        deal:     { via: 'deal_id',      type: 'many_to_one', nullable: true },
        feedback: { via: 'agent_run_id', table: 'agent_feedback', type: 'one_to_many' },
      },
    },

  },

  // ── QUERY ROUTING ─────────────────────────────────────────────────────────
  // Used by the planning step to sequence tool calls correctly.
  // Prevents multi-hop guessing and redundant skill re-execution.

  query_routing: {
    deal_health:          ['deal', 'stage_history', 'skill_run:pipeline-hygiene',
                           'skill_run:prospect-score', 'conversations'],
    deal_stall_diagnosis: ['stage_history', 'conversations',
                           'skill_run:behavioral-winning-path', 'calendar_events'],
    forecast:             ['deal', 'skill_run:forecast-rollup',
                           'skill_run:pandora-weighted', 'skill_run:monte-carlo'],
    pipeline_coverage:    ['deal', 'skill_run:pipeline-coverage-by-rep',
                           'skill_run:pipeline-waterfall'],
    rep_performance:      ['user', 'deal', 'stage_history',
                           'skill_run:rep-scorecard'],
    relationship_health:  ['contact', 'conversations', 'calendar_events', 'deal'],
    data_quality:         ['deal', 'skill_run:data-quality-audit'],
    icp_fit:              ['deal', 'contact', 'skill_run:icp-fit',
                           'skill_run:conversation-intelligence'],
  },

  // ── INJECTION RULES ───────────────────────────────────────────────────────
  // Controls what gets loaded, when, and at what cost.

  injection: {
    full_graph_threshold:    'query_complexity > 1 OR multi_entity_question',
    single_entity_skip:      'Simple lookups skip the graph entirely',
    max_tokens_in_prompt:    '~800 tokens for full graph — acceptable overhead',
    scoped_variant_triggers: ['deal_id present', 'rep_id present', 'stage filter active'],
  },

} as const;
