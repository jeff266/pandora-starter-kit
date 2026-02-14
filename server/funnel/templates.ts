/**
 * Funnel Templates
 *
 * Pre-defined funnel templates for different sales motions.
 * Templates provide stage definitions without CRM mappings - those get filled in
 * by discovery or manually by the user.
 */

import type { FunnelTemplate, FunnelStage } from '../types/funnel.js';

const FUNNEL_TEMPLATES: Record<string, FunnelTemplate> = {
  classic_b2b: {
    model_type: 'classic_b2b',
    model_label: 'Classic B2B',
    stages: [
      {
        id: 'lead',
        label: 'Lead',
        side: 'pre_sale',
        order: 1,
        description: 'Raw lead or subscriber, not yet qualified',
        source: { object: 'contacts', field: '', values: [] },
      },
      {
        id: 'mql',
        label: 'Marketing Qualified',
        side: 'pre_sale',
        order: 2,
        description: 'Met marketing qualification criteria (score, behavior, fit)',
        source: { object: 'contacts', field: '', values: [] },
      },
      {
        id: 'sql',
        label: 'Sales Qualified',
        side: 'pre_sale',
        order: 3,
        description: 'Sales accepted, first meeting held or scheduled',
        source: { object: 'contacts', field: '', values: [] },
      },
      {
        id: 'sao',
        label: 'Sales Accepted Opportunity',
        side: 'pre_sale',
        order: 4,
        description: 'Deal created, actively working the opportunity',
        source: {
          object: 'deals',
          field: 'stage_normalized',
          values: ['qualification', 'discovery', 'proposal', 'negotiation'],
        },
      },
      {
        id: 'won',
        label: 'Closed Won',
        side: 'center',
        order: 5,
        description: 'Deal signed and booked',
        source: { object: 'deals', field: 'stage_normalized', values: ['closed_won'] },
      },
      {
        id: 'onboarding',
        label: 'Onboarding',
        side: 'post_sale',
        order: 6,
        description: 'Implementation or setup in progress',
        source: { object: 'deals', field: '', values: [] },
      },
      {
        id: 'expansion',
        label: 'Expansion',
        side: 'post_sale',
        order: 7,
        description: 'Upsell or cross-sell opportunity',
        source: { object: 'deals', field: '', values: [] },
      },
      {
        id: 'renewal',
        label: 'Renewal',
        side: 'post_sale',
        order: 8,
        description: 'Contract renewal cycle',
        source: { object: 'deals', field: '', values: [] },
      },
    ],
  },

  plg: {
    model_type: 'plg',
    model_label: 'Product-Led Growth',
    stages: [
      {
        id: 'signup',
        label: 'Signup',
        side: 'pre_sale',
        order: 1,
        description: 'Account created, free tier or trial started',
        source: { object: 'contacts', field: '', values: [] },
      },
      {
        id: 'activated',
        label: 'Activated',
        side: 'pre_sale',
        order: 2,
        description: 'Completed key activation milestone (first project, first integration, etc.)',
        source: { object: 'contacts', field: '', values: [] },
      },
      {
        id: 'engaged',
        label: 'Engaged',
        side: 'pre_sale',
        order: 3,
        description: 'Regular usage pattern established, PQL criteria met',
        source: { object: 'contacts', field: '', values: [] },
      },
      {
        id: 'converted',
        label: 'Converted',
        side: 'center',
        order: 4,
        description: 'Upgraded to paid plan or first contract signed',
        source: { object: 'deals', field: 'stage_normalized', values: ['closed_won'] },
      },
      {
        id: 'expanded',
        label: 'Expanded',
        side: 'post_sale',
        order: 5,
        description: 'Increased usage, added seats, or upgraded plan',
        source: { object: 'deals', field: '', values: [] },
      },
      {
        id: 'renewed',
        label: 'Renewed',
        side: 'post_sale',
        order: 6,
        description: 'Renewed subscription or contract',
        source: { object: 'deals', field: '', values: [] },
      },
    ],
  },

  enterprise: {
    model_type: 'enterprise',
    model_label: 'Enterprise Sales',
    stages: [
      {
        id: 'target',
        label: 'Target Account',
        side: 'pre_sale',
        order: 1,
        description: 'Identified as ICP fit, not yet engaged',
        source: { object: 'leads', field: '', values: [] },
      },
      {
        id: 'engaged',
        label: 'Engaged',
        side: 'pre_sale',
        order: 2,
        description: 'First meaningful interaction (meeting, response, event)',
        source: { object: 'leads', field: '', values: [] },
      },
      {
        id: 'qualified',
        label: 'Qualified Opportunity',
        side: 'pre_sale',
        order: 3,
        description: 'Passed qualification (MEDDICC/BANT), deal created',
        source: { object: 'deals', field: 'stage_normalized', values: ['qualification'] },
      },
      {
        id: 'eval',
        label: 'Technical Evaluation',
        side: 'pre_sale',
        order: 4,
        description: 'POC, pilot, or technical assessment in progress',
        source: { object: 'deals', field: 'stage_normalized', values: ['proposal'] },
      },
      {
        id: 'business_case',
        label: 'Business Case',
        side: 'pre_sale',
        order: 5,
        description: 'ROI presented, procurement engaged, legal review',
        source: { object: 'deals', field: 'stage_normalized', values: ['negotiation'] },
      },
      {
        id: 'won',
        label: 'Closed Won',
        side: 'center',
        order: 6,
        description: 'Contract executed',
        source: { object: 'deals', field: 'stage_normalized', values: ['closed_won'] },
      },
      {
        id: 'implementation',
        label: 'Implementation',
        side: 'post_sale',
        order: 7,
        description: 'Deployment, integration, training',
        source: { object: 'deals', field: '', values: [] },
      },
      {
        id: 'adoption',
        label: 'Adoption',
        side: 'post_sale',
        order: 8,
        description: 'Active usage, value realization tracked',
        source: { object: 'deals', field: '', values: [] },
      },
      {
        id: 'expansion',
        label: 'Expansion',
        side: 'post_sale',
        order: 9,
        description: 'Additional modules, departments, or use cases',
        source: { object: 'deals', field: '', values: [] },
      },
    ],
  },

  velocity: {
    model_type: 'velocity',
    model_label: 'High-Velocity Sales',
    stages: [
      {
        id: 'inbound',
        label: 'Inbound',
        side: 'pre_sale',
        order: 1,
        description: 'Form fill, chat request, demo request',
        source: { object: 'contacts', field: '', values: [] },
      },
      {
        id: 'demo',
        label: 'Demo Completed',
        side: 'pre_sale',
        order: 2,
        description: 'Product demo delivered',
        source: { object: 'deals', field: 'stage_normalized', values: ['discovery'] },
      },
      {
        id: 'trial',
        label: 'Trial / Eval',
        side: 'pre_sale',
        order: 3,
        description: 'Free trial or evaluation period active',
        source: { object: 'deals', field: 'stage_normalized', values: ['qualification', 'proposal'] },
      },
      {
        id: 'proposal',
        label: 'Proposal Sent',
        side: 'pre_sale',
        order: 4,
        description: 'Pricing sent, awaiting decision',
        source: { object: 'deals', field: 'stage_normalized', values: ['negotiation'] },
      },
      {
        id: 'won',
        label: 'Closed Won',
        side: 'center',
        order: 5,
        description: 'Contract signed',
        source: { object: 'deals', field: 'stage_normalized', values: ['closed_won'] },
      },
      {
        id: 'live',
        label: 'Live',
        side: 'post_sale',
        order: 6,
        description: 'Customer active and using product',
        source: { object: 'deals', field: '', values: [] },
      },
    ],
  },

  channel: {
    model_type: 'channel',
    model_label: 'Channel / Partner Sales',
    stages: [
      {
        id: 'partner_sourced',
        label: 'Partner Sourced',
        side: 'pre_sale',
        order: 1,
        description: 'Lead referred by channel partner',
        source: { object: 'leads', field: '', values: [] },
      },
      {
        id: 'qualified',
        label: 'Qualified',
        side: 'pre_sale',
        order: 2,
        description: 'Validated fit, co-sell initiated',
        source: { object: 'deals', field: 'stage_normalized', values: ['qualification'] },
      },
      {
        id: 'co_sell',
        label: 'Co-Sell Active',
        side: 'pre_sale',
        order: 3,
        description: 'Joint selling with partner, deal in progress',
        source: { object: 'deals', field: 'stage_normalized', values: ['proposal', 'negotiation'] },
      },
      {
        id: 'won',
        label: 'Closed Won',
        side: 'center',
        order: 4,
        description: 'Contract signed',
        source: { object: 'deals', field: 'stage_normalized', values: ['closed_won'] },
      },
      {
        id: 'managed',
        label: 'Partner Managed',
        side: 'post_sale',
        order: 5,
        description: 'Customer managed by partner post-sale',
        source: { object: 'deals', field: '', values: [] },
      },
    ],
  },
};

/**
 * Get a specific funnel template by model type
 */
export function getTemplate(modelType: string): FunnelTemplate | undefined {
  return FUNNEL_TEMPLATES[modelType];
}

/**
 * List all available templates with metadata
 */
export function listTemplates(): Array<{
  model_type: string;
  model_label: string;
  stage_count: number;
  pre_sale: number;
  post_sale: number;
}> {
  return Object.entries(FUNNEL_TEMPLATES).map(([key, template]) => ({
    model_type: key,
    model_label: template.model_label,
    stage_count: template.stages.length,
    pre_sale: template.stages.filter(s => s.side === 'pre_sale').length,
    post_sale: template.stages.filter(s => s.side === 'post_sale').length,
  }));
}

/**
 * Get all templates (for internal use)
 */
export function getAllTemplates(): Record<string, FunnelTemplate> {
  return FUNNEL_TEMPLATES;
}
