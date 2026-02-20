/**
 * Feature Flag Registry
 * Defines all feature flags organized by plan tier
 */

interface FlagDefinition {
  plans: string[];
  requires_connector?: string[];
  beta?: boolean;
}

export const FEATURE_FLAG_REGISTRY: Record<string, FlagDefinition> = {
  // Starter plan features (always on)
  'feature.pipeline_health': { plans: ['starter', 'growth', 'pro', 'enterprise'] },
  'feature.deal_scoring': { plans: ['starter', 'growth', 'pro', 'enterprise'] },
  'feature.slack_delivery': { plans: ['starter', 'growth', 'pro', 'enterprise'] },
  'feature.command_center': { plans: ['starter', 'growth', 'pro', 'enterprise'] },

  // Growth plan features
  'feature.icp_discovery': { plans: ['growth', 'pro', 'enterprise'] },
  'feature.lead_scoring': { plans: ['growth', 'pro', 'enterprise'] },
  'feature.rep_scorecard': { plans: ['growth', 'pro', 'enterprise'] },
  'feature.forecast_rollup': { plans: ['growth', 'pro', 'enterprise'] },
  'feature.agent_builder': { plans: ['growth', 'pro', 'enterprise'] },
  'feature.custom_roles': { plans: ['growth', 'pro', 'enterprise'] },

  // Pro plan features
  'feature.conversation_intelligence': {
    plans: ['pro', 'enterprise'],
    requires_connector: ['gong', 'fireflies'],
  },
  'feature.pipeline_waterfall': { plans: ['pro', 'enterprise'] },
  'feature.monte_carlo_forecasting': { plans: ['pro', 'enterprise'] },
  'feature.cross_entity_linker': { plans: ['pro', 'enterprise'] },
  'feature.byok': { plans: ['pro', 'enterprise'] },

  // Enterprise plan features
  'feature.marketplace': { plans: ['enterprise'], beta: true },
  'feature.multi_workspace_view': { plans: ['enterprise'] },

  // Capability flags (always seeded regardless of plan)
  'cap.show_evidence_panel': { plans: ['starter', 'growth', 'pro', 'enterprise'] },
  'cap.allow_evidence_export': { plans: [] }, // Default false, opt-in
  'cap.anonymize_workspace': { plans: [] }, // Default false, opt-in
  'cap.slack_digest_preview': { plans: ['starter', 'growth', 'pro', 'enterprise'] },
  'cap.agent_token_meter': { plans: ['starter', 'growth', 'pro', 'enterprise'] },
  'cap.show_raw_sql': { plans: [] }, // Default false, opt-in
};

interface FlagSeed {
  key: string;
  value: boolean;
  flag_type: string;
}

/**
 * Get all flags that should be seeded for a given plan
 * Returns feature flags for the plan tier + all capability flags with defaults
 */
export function getFlagsForPlan(plan: string): FlagSeed[] {
  const flags: FlagSeed[] = [];

  for (const [key, definition] of Object.entries(FEATURE_FLAG_REGISTRY)) {
    const isFeature = key.startsWith('feature.');
    const isCapability = key.startsWith('cap.');

    if (isFeature) {
      // Feature flags: enabled if plan is in the allowed plans list
      const enabled = definition.plans.includes(plan);
      flags.push({
        key,
        value: enabled,
        flag_type: 'feature',
      });
    } else if (isCapability) {
      // Capability flags: default based on whether plan is in list
      const defaultEnabled = definition.plans.includes(plan);
      flags.push({
        key,
        value: defaultEnabled,
        flag_type: 'capability',
      });
    }
  }

  return flags;
}
