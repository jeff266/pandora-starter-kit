import React from 'react';
import { colors, fonts } from '../styles/theme';

interface Tool {
  id: string;
  name: string;
  description: string;
  category: string;
  status: 'live' | 'experimental' | 'coming_soon';
}

const TOOLS: Tool[] = [
  // Data Query Tools
  { id: 'query_deals', name: 'Query Deals', description: 'Search and filter deals by stage, owner, amount, close date, and custom fields.', category: 'Data', status: 'live' },
  { id: 'query_accounts', name: 'Query Accounts', description: 'Fetch account records with contacts, deals, and engagement history.', category: 'Data', status: 'live' },
  { id: 'query_contacts', name: 'Query Contacts', description: 'Search contacts by name, email, role, and account association.', category: 'Data', status: 'live' },
  { id: 'query_conversations', name: 'Query Conversations', description: 'Search call recordings and meeting transcripts by account, rep, or topic.', category: 'Data', status: 'live' },
  { id: 'query_stage_history', name: 'Query Stage History', description: 'Track how deals moved through pipeline stages over time.', category: 'Data', status: 'live' },
  { id: 'query_field_history', name: 'Query Field History', description: 'View changes to deal fields like amount, close date, and owner.', category: 'Data', status: 'live' },
  { id: 'query_activity_timeline', name: 'Activity Timeline', description: 'Pull emails, calls, and meetings associated with a deal or account.', category: 'Data', status: 'live' },
  // Compute Tools
  { id: 'compute_metric', name: 'Compute Metric', description: 'Calculate key metrics: win rate, pipeline total, average deal size, sales cycle length, and coverage ratio.', category: 'Analytics', status: 'live' },
  { id: 'compute_metric_segmented', name: 'Segmented Metrics', description: 'Break down any metric by rep, stage, pipeline, or time period.', category: 'Analytics', status: 'live' },
  { id: 'compute_stage_benchmarks', name: 'Stage Benchmarks', description: 'Calculate median time-in-stage and conversion rates across your pipeline.', category: 'Analytics', status: 'live' },
  { id: 'compute_win_rate', name: 'Win Rate Analysis', description: 'Detailed win/loss analysis with configurable filters and exclusions.', category: 'Analytics', status: 'live' },
  { id: 'compute_forecast_accuracy', name: 'Forecast Accuracy', description: 'Compare predicted vs actual close dates and amounts to measure rep forecasting quality.', category: 'Analytics', status: 'live' },
  { id: 'compute_close_probability', name: 'Close Probability', description: 'Score individual deals on their likelihood to close based on historical patterns.', category: 'Analytics', status: 'live' },
  { id: 'compute_pipeline_creation', name: 'Pipeline Creation', description: 'Track how much new pipeline is being generated over time.', category: 'Analytics', status: 'live' },
  { id: 'compute_inqtr_close_rate', name: 'In-Quarter Close Rate', description: 'Measure the rate at which deals in the current quarter actually close.', category: 'Analytics', status: 'live' },
  { id: 'compute_competitive_rates', name: 'Competitive Win Rates', description: 'Break down win/loss rates by competitor to surface competitive patterns.', category: 'Analytics', status: 'live' },
  // Intelligence Tools
  { id: 'get_skill_evidence', name: 'Skill Evidence', description: 'Pull structured evidence records from any skill run for export or review.', category: 'Intelligence', status: 'live' },
  { id: 'search_transcripts', name: 'Transcript Search', description: 'Semantic search across call and meeting transcripts for topics, objections, or competitor mentions.', category: 'Intelligence', status: 'live' },
];

const STATUS_BADGE: Record<Tool['status'], { label: string; bg: string; color: string }> = {
  live: { label: 'Live', bg: '#14532d', color: '#86efac' },
  experimental: { label: 'Beta', bg: '#78350f', color: '#fde68a' },
  coming_soon: { label: 'Coming Soon', bg: '#1e293b', color: '#64748b' },
};

const CATEGORY_ORDER = ['Data', 'Analytics', 'Intelligence'];
export default function ToolsPage() {
  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    tools: TOOLS.filter(t => t.category === cat),
  }));

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: colors.text, fontFamily: fonts.sans, margin: 0, marginBottom: 6 }}>Data Tools</h1>
        <p style={{ fontSize: 13, color: colors.textSecondary, fontFamily: fonts.sans, margin: 0 }}>
          The building blocks Pandora uses to answer questions and run skills. Tools run automatically as part of analysis — you don't invoke them directly.
        </p>
      </div>

      {grouped.map(({ category, tools }) => (
        <div key={category} style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, fontFamily: fonts.sans, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
            {category}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {tools.map(tool => {
              const badge = STATUS_BADGE[tool.status];
              return (
                <div key={tool.id} style={{
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 16,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>{tool.name}</span>
                      <span style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.textMuted }}>{tool.id}</span>
                    </div>
                    <div style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans, lineHeight: 1.5 }}>{tool.description}</div>
                  </div>
                  <span style={{
                    flexShrink: 0,
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 10,
                    background: badge.bg,
                    color: badge.color,
                    fontFamily: fonts.sans,
                    alignSelf: 'flex-start',
                  }}>
                    {tool.status === 'experimental' && '🧪 '}{badge.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
