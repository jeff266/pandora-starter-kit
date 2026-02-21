// Section Content Generator
// Converts ReportSection → SectionContent by pulling from skill evidence

import { query } from '../db.js';
import { ReportSection, SectionContent, VoiceConfig } from './types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SectionGenerator');

export async function generateSectionContent(
  workspaceId: string,
  section: ReportSection,
  voiceConfig: VoiceConfig
): Promise<SectionContent> {
  logger.info('Generating section content', { section_id: section.id, skills: section.skills });

  // Phase 1: Generate placeholder content
  // Phase 2: Pull from skill evidence cache or run skills
  // Phase 3: Use LLM to synthesize narrative from evidence

  const content: SectionContent = {
    section_id: section.id,
    title: section.label,
    narrative: await generatePlaceholderNarrative(section, voiceConfig),
    source_skills: section.skills,
    data_freshness: new Date().toISOString(),
    confidence: 0.8,
  };

  // Add structured elements based on section type
  if (section.id === 'the-number') {
    content.metrics = [
      { label: 'Forecast', value: '$2.4M', severity: 'good' },
      { label: 'Monte Carlo P50', value: '$2.2M', severity: 'warning' },
      { label: 'Pacing', value: '87%', delta: '+3%', delta_direction: 'up', severity: 'good' },
    ];
  }

  if (section.id === 'rep-performance') {
    content.table = {
      headers: ['Rep', 'Pipeline', 'Coverage', 'Win Rate', 'Deals'],
      rows: [
        { Rep: 'Sarah Chen', Pipeline: '$1.2M', Coverage: '3.2x', 'Win Rate': '28%', Deals: 8 },
        { Rep: 'Mike Johnson', Pipeline: '$890K', Coverage: '2.7x', 'Win Rate': '22%', Deals: 6 },
        { Rep: 'Lisa Park', Pipeline: '$1.5M', Coverage: '4.1x', 'Win Rate': '31%', Deals: 12 },
      ],
    };
  }

  if (section.id === 'deals-needing-attention') {
    content.deal_cards = [
      {
        name: 'Acme Corp - Enterprise',
        amount: '$450K',
        owner: 'Sarah Chen',
        stage: 'Negotiation',
        signal: 'No activity in 14 days',
        signal_severity: 'critical',
        detail: 'Champion went dark after pricing discussion',
        action: 'Schedule call with economic buyer to address timeline',
      },
      {
        name: 'TechStart Inc',
        amount: '$180K',
        owner: 'Mike Johnson',
        stage: 'Proposal',
        signal: 'Single-threaded',
        signal_severity: 'warning',
        detail: 'Only engaging with one contact (IT lead)',
        action: 'Request introduction to VP or C-level sponsor',
      },
    ];
  }

  if (section.config.include_chart && section.id === 'forecast-waterfall') {
    content.chart_data = {
      type: 'waterfall',
      labels: ['Start', 'New', 'Won', 'Lost', 'Moved', 'End'],
      datasets: [{
        label: 'Pipeline Movement',
        data: [4200000, 890000, -650000, -220000, 180000, 4400000],
        color: '#3b82f6',
      }],
    };
  }

  return content;
}

async function generatePlaceholderNarrative(
  section: ReportSection,
  voiceConfig: VoiceConfig
): Promise<string> {
  // Phase 1: Return section-specific placeholder
  // Phase 2-3: Pull from skill evidence and synthesize with LLM

  const narratives: Record<string, string> = {
    'the-number': 'The forecast shows $2.4M in committed pipeline, tracking at 87% of monthly target. Monte Carlo simulation suggests a P50 landing zone of $2.2M. Three deals totaling $890K are at risk of slipping based on recent activity patterns.',

    'what-moved': 'This week saw $650K in closed-won deals (3 opportunities), with Acme Corp ($450K) being the largest win. Two deals totaling $220K moved backwards from Negotiation to Proposal after pricing pushback. Net pipeline increased by $180K.',

    'deals-needing-attention': '4 deals totaling $1.1M require immediate attention. Acme Corp ($450K) has gone dark for 14 days post-pricing discussion. TechStart ($180K) and two others are single-threaded with no executive engagement.',

    'rep-performance': 'Sarah Chen leads with $1.2M pipeline at 3.2x coverage and 28% win rate. Lisa Park shows strongest execution with 4.1x coverage and 31% win rate across 12 active deals. Mike Johnson needs 1.3x more coverage to hit quarterly target.',

    'pipeline-hygiene': '18 open deals ($2.3M) have data quality issues. 12 deals lack close dates, 8 are missing contact roles, and 4 have stale next steps (>30 days old). Estimated impact: 15% reduction in forecast accuracy.',

    'call-intelligence': 'Competitor mentions up 40% this month (23 calls). Salesforce came up in 12 conversations, HubSpot in 8. Champion signals detected in 15 calls. Common objection: "timeline uncertainty" (9 mentions).',

    'pipeline-coverage': 'Current coverage ratio is 2.8x against 3.0x target. To hit quarterly goal, team needs $1.2M in new pipeline creation. West territory is under-covered at 1.9x. Central and East territories exceed 3.2x.',

    'icp-fit-analysis': '67% of new leads match ICP criteria (Tier 1 or Tier 2). Top 5 accounts show avg fit score of 89. Sales-assisted segment shows 2.4x higher conversion than PLG segment. Recommend increasing inbound volume to Sales-assisted by 30%.',

    'forecast-waterfall': 'Net pipeline movement: +$180K this week. New pipeline created: $890K. Closed-won: $650K. Closed-lost: $220K. Stage progression added $180K through velocity improvements in Proposal → Negotiation.',

    'actions-summary': 'Top priority: Re-engage 4 dark deals ($1.1M) within 48 hours. Second: Add 3 multi-threaded contacts to single-threaded deals. Third: Update 12 missing close dates to improve forecast accuracy. Fourth: Create $400K new pipeline to close coverage gap. Fifth: Schedule pricing training for reps citing competitor concerns.',
  };

  return narratives[section.id] || `Content for "${section.label}" section will be generated from ${section.skills.join(', ')}.`;
}
