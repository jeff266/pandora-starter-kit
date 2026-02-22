/**
 * Editorial Synthesis Types
 *
 * The editorial synthesizer reads skill evidence and produces briefings.
 * Unlike section-generator.ts (which fills templates), this makes editorial
 * decisions about structure, emphasis, and narrative.
 */

import type { SectionContent, ReportSection, VoiceConfig } from '../reports/types.js';
import type { SkillEvidence } from '../skills/types.js';
import type { AgentDefinition } from './types.js';

// ============================================================================
// Editorial Input
// ============================================================================

export interface DataWindowConfig {
  primary: 'current_week' | 'current_month' | 'current_quarter' | 'trailing_30d' | 'trailing_90d' | 'fiscal_year';
  comparison: 'previous_period' | 'same_period_last_year' | 'none';
}

export interface EditorialInput {
  /** The agent configuration */
  agent: AgentDefinition;

  /** Workspace and run IDs */
  workspaceId: string;
  runId: string;

  /** All skill evidence (already fresh — prep agent or staleness check ran first) */
  skillEvidence: Record<string, SkillEvidence>;

  /** The section library — what sections are available */
  availableSections: ReportSection[];

  /** Tuning pairs from previous feedback */
  tuningPairs: TuningPair[];

  /** Previous output for self-reference (Phase 3, null until then) */
  previousOutput?: AgentBriefingOutput;

  /** Voice and audience config */
  voiceConfig: VoiceConfig;
  audience: AudienceConfig;

  /** Focus questions the reader wants answered */
  focusQuestions?: string[];

  /** Data window for temporal context */
  dataWindow?: DataWindowConfig;

  /** Memory context from previous runs (Phase 3) */
  memoryContext?: string;
}

// ============================================================================
// Editorial Output
// ============================================================================

export interface EditorialOutput {
  /** The editorial decisions the agent made (logged for transparency) */
  editorial_decisions: EditorialDecision[];

  /** The actual briefing content */
  sections: SectionContent[];

  /** The narrative opening */
  opening_narrative: string;

  /** Metadata */
  skills_referenced: string[];
  sections_included: string[];
  sections_dropped: string[];
  tokens_used: number;
  synthesis_duration_ms: number;
}

export interface EditorialDecision {
  decision: 'lead_with' | 'drop_section' | 'promote_finding' | 'merge_sections' | 'add_callout' | 'adjust_depth';
  reasoning: string;          // "Coverage dropped 40% — this is the story this week"
  affected_sections: string[];
}

// ============================================================================
// Audience Configuration
// ============================================================================

export interface AudienceConfig {
  /** Who is this briefing for? */
  role: string;              // "VP Sales", "CRO", "Board of Directors", "Sales Manager"

  /** How much detail do they want? */
  detail_preference: 'executive' | 'manager' | 'analyst';

  /** Words/phrases to avoid */
  vocabulary_avoid?: string[]; // ["MEDDPICC", "single-thread", "weighted pipeline"]

  /** Words/phrases to prefer */
  vocabulary_prefer?: string[]; // ["revenue", "attainment", "pipeline generation"]
}

// ============================================================================
// Tuning Pairs
// ============================================================================

export interface TuningPair {
  key: string;                // "emphasis_preference", "section_depth:pipeline-hygiene"
  value: any;                 // { instruction: "Keep brief", confidence: 0.8 }
  source: string;             // "user_feedback" | "system"
  confidence: number;         // 0-1
}

// ============================================================================
// Agent Briefing Output (for Phase 3 memory)
// ============================================================================

export interface AgentBriefingOutput {
  generation_id: string;
  generated_at: string;
  opening_narrative: string;
  sections: SectionContent[];
  editorial_decisions: EditorialDecision[];
}

// ============================================================================
// Run Digest (Phase 3)
// ============================================================================

export interface AgentRunDigest {
  generated_at: string;
  opening_narrative: string;

  /** Compressed findings — just the claims, not the full sections */
  key_findings: {
    section_id: string;
    headline: string;                  // One line: "Coverage at 1.4x, below 2.0x threshold"
    deals_flagged: string[];           // Deal names only: ["Apex Industries", "Helios Corp"]
    metrics_snapshot: Record<string, number>;  // { coverage: 1.4, stale_count: 12, forecast_gap: -2100000 }
    severity: 'good' | 'warning' | 'critical';
  }[];

  /** Action items the agent recommended */
  actions_recommended: {
    deal_or_target: string;
    action: string;
    urgency: string;
  }[];

  /** Editorial decisions made */
  sections_included: string[];
  sections_dropped: string[];
  lead_section: string;
}

// ============================================================================
// Rolling Memory (Phase 3)
// ============================================================================

export interface AgentMemory {
  workspace_id: string;
  agent_id: string;

  /** Persistent counters — what keeps coming up */
  recurring_flags: {
    key: string;                       // "stale_deals_manufacturing"
    first_flagged: string;             // ISO date
    times_flagged: number;             // 3
    last_flagged: string;              // ISO date
    resolved: boolean;
  }[];

  /** Deal tracking — what we said about specific deals */
  deal_history: {
    deal_name: string;
    deal_id: string;
    first_mentioned: string;
    mentions: {
      date: string;
      status: string;                  // "flagged_at_risk", "recommended_action", "closed_won"
      summary: string;                 // One line
    }[];
  }[];  // Capped at 20 deals, FIFO

  /** Metric trend (last 8 data points per metric) */
  metric_history: {
    metric: string;                    // "pipeline_coverage", "forecast_gap", "stale_deal_count"
    values: { date: string; value: number }[];  // Max 8 entries
  }[];

  /** Prediction tracking */
  predictions: {
    date: string;
    prediction: string;               // "Apex will slip past March close date"
    outcome: string | null;            // "closed_won" | "slipped" | null (pending)
    correct: boolean | null;
  }[];  // Capped at 10

  last_updated: string;
}
