// Report Section Library
// Pre-built sections that users can add to their reports

import { ReportSection } from './types.js';

interface SectionDefinition {
  id: string;
  label: string;
  description: string;
  skills: string[];
  default_config: ReportSection['config'];
  category: 'forecast' | 'pipeline' | 'performance' | 'intelligence' | 'operations';
}

export const SECTION_LIBRARY: SectionDefinition[] = [
  {
    id: 'the-number',
    label: 'The Number',
    description: 'Forecast landing zone with bear/base/bull scenarios and pacing bar',
    skills: ['forecast-rollup', 'monte-carlo'],
    default_config: {
      detail_level: 'executive',
      include_chart: true,
      metrics: ['forecast_amount', 'pacing', 'monte_carlo_p50'],
    },
    category: 'forecast',
  },
  {
    id: 'what-moved',
    label: 'What Moved This Week',
    description: 'Closed-won deals, stage changes, pushed deals, and net pipeline movement',
    skills: ['forecast-rollup', 'pipeline-waterfall'],
    default_config: {
      detail_level: 'manager',
      include_deal_list: true,
      max_items: 10,
    },
    category: 'pipeline',
  },
  {
    id: 'deals-needing-attention',
    label: 'Deals Needing Attention',
    description: 'Risk-flagged deals with recommended actions and signal severity',
    skills: ['deal-risk-review', 'single-thread-alert', 'conversation-intelligence'],
    default_config: {
      detail_level: 'manager',
      include_deal_list: true,
      max_items: 15,
      threshold_overrides: {
        risk_threshold: 70, // Show deals with risk >= 70
      },
    },
    category: 'pipeline',
  },
  {
    id: 'rep-performance',
    label: 'Rep Performance',
    description: 'Performance table with pipeline coverage, win rates, and narrative takeaways',
    skills: ['rep-scorecard', 'pipeline-coverage'],
    default_config: {
      detail_level: 'manager',
      metrics: ['pipeline', 'coverage_ratio', 'win_rate', 'avg_deal_size'],
      include_chart: false,
    },
    category: 'performance',
  },
  {
    id: 'pipeline-hygiene',
    label: 'Pipeline Hygiene',
    description: 'Data quality issues with quantified pipeline impact and recommended fixes',
    skills: ['pipeline-hygiene', 'data-quality-audit', 'single-thread-alert'],
    default_config: {
      detail_level: 'analyst',
      include_deal_list: true,
      max_items: 20,
    },
    category: 'operations',
  },
  {
    id: 'call-intelligence',
    label: 'Call Intelligence',
    description: 'Competitor mentions, champion signals, objections, and coaching opportunities',
    skills: ['conversation-intelligence'],
    default_config: {
      detail_level: 'manager',
      max_items: 10,
      metrics: ['total_calls', 'competitor_mentions', 'champion_signals'],
    },
    category: 'intelligence',
  },
  {
    id: 'pipeline-coverage',
    label: 'Pipeline Coverage',
    description: 'Coverage ratios by rep/segment with gap analysis and required new pipeline',
    skills: ['pipeline-coverage', 'forecast-rollup'],
    default_config: {
      detail_level: 'executive',
      metrics: ['coverage_ratio', 'gap_to_target', 'new_pipeline_required'],
      include_chart: true,
      threshold_overrides: {
        target_coverage: 3.0,
      },
    },
    category: 'forecast',
  },
  {
    id: 'icp-fit-analysis',
    label: 'ICP Fit Analysis',
    description: 'ICP thesis, top-fit leads, segment distribution, and scoring breakdown',
    skills: ['icp-discovery', 'lead-scoring'],
    default_config: {
      detail_level: 'analyst',
      max_items: 15,
      metrics: ['icp_match_rate', 'top_tier_leads', 'avg_fit_score'],
    },
    category: 'intelligence',
  },
  {
    id: 'forecast-waterfall',
    label: 'Forecast Waterfall',
    description: 'Net pipeline movement bridge chart showing adds, stage changes, and exits',
    skills: ['pipeline-waterfall', 'deal-stage-history'],
    default_config: {
      detail_level: 'executive',
      include_chart: true,
      metrics: ['net_change', 'closed_won', 'closed_lost', 'new_created'],
    },
    category: 'forecast',
  },
  {
    id: 'actions-summary',
    label: 'Actions Summary',
    description: 'Top 5 recommended actions distilled from all report sections',
    skills: [], // Auto-generated from other sections
    default_config: {
      detail_level: 'executive',
      max_items: 5,
    },
    category: 'operations',
  },
];

// Helper to get section definition by ID
export function getSectionDefinition(sectionId: string): SectionDefinition | undefined {
  return SECTION_LIBRARY.find(s => s.id === sectionId);
}

// Helper to create a section from definition
export function createSectionFromDefinition(
  sectionId: string,
  order: number,
  configOverrides?: Partial<ReportSection['config']>
): ReportSection | null {
  const def = getSectionDefinition(sectionId);
  if (!def) return null;

  return {
    id: def.id,
    label: def.label,
    description: def.description,
    skills: def.skills,
    config: {
      ...def.default_config,
      ...configOverrides,
    },
    order,
    enabled: true,
  };
}

// Get all sections by category
export function getSectionsByCategory(category: SectionDefinition['category']): SectionDefinition[] {
  return SECTION_LIBRARY.filter(s => s.category === category);
}

// Get required skills for a list of sections
export function getRequiredSkills(sections: ReportSection[]): string[] {
  const skillSet = new Set<string>();
  for (const section of sections) {
    for (const skill of section.skills) {
      skillSet.add(skill);
    }
  }
  return Array.from(skillSet);
}
