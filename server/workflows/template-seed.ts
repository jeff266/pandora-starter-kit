/**
 * Workflow Template Seeds
 *
 * Pre-built workflow templates for common use cases.
 */

import { Pool } from 'pg';
import { WorkflowTemplate, WorkflowTree } from './types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TemplateSeed');

export const SEED_TEMPLATES: Omit<WorkflowTemplate, 'id' | 'created_at' | 'popularity'>[] = [
  {
    name: 'Stale Deal Cleanup',
    description: 'Automatically notify reps when a critical deal needs re-engagement',
    category: 'Sales Operations',
    required_connectors: ['slack'],
    required_action_types: ['re_engage_deal'],
    icon: '🔔',
    tags: ['sales', 'notifications', 'pipeline-hygiene'],
    tree: {
      version: '1.0',
      trigger: {
        type: 'action_event',
        config: {
          action_types: ['re_engage_deal'],
          severity_filter: ['critical'],
        },
      },
      steps: [
        {
          id: 'notify_rep',
          name: 'Notify rep in Slack',
          type: 'slack_notify',
          config: {
            channel: '{{action.assignee_slack_dm}}',
            message_template:
              '🚨 *Critical: Deal needs attention*\n\n*{{action.target_deal_name}}* ({{action.impact_label}})\n\n{{action.summary}}\n\nRecommended action:\n{{action.recommended_steps}}',
          },
        },
        {
          id: 'mark_in_progress',
          name: 'Mark action in progress',
          type: 'pandora_callback',
          config: {
            endpoint: '/api/workspaces/{{workspace_id}}/actions/{{action.id}}/status',
            payload: {
              status: 'in_progress',
              message: 'Notification sent to rep',
            },
          },
        },
      ],
    } as WorkflowTree,
  },
  {
    name: 'Manager Escalation for High-Value Deals',
    description: 'Escalate critical pipeline issues for deals > $50K to management channel',
    category: 'Sales Operations',
    required_connectors: ['slack'],
    required_action_types: ['re_engage_deal', 'escalate_deal', 'close_stale_deal'],
    icon: '⚠️',
    tags: ['sales', 'escalation', 'management'],
    tree: {
      version: '1.0',
      trigger: {
        type: 'action_event',
        config: {
          action_types: ['re_engage_deal', 'escalate_deal', 'close_stale_deal'],
          severity_filter: ['critical'],
        },
      },
      steps: [
        {
          id: 'check_amount',
          name: 'Check deal value',
          type: 'conditional',
          config: {
            condition: {
              field: '{{action.impact_amount}}',
              operator: 'gt',
              value: 50000,
            },
            if_true: [
              {
                id: 'escalate_to_manager',
                name: 'Escalate to #pipeline-critical',
                type: 'slack_notify',
                config: {
                  channel: '#pipeline-critical',
                  message_template:
                    '🚨 *High-value deal at risk*\n\n*Deal:* {{action.target_deal_name}}\n*Value:* {{action.impact_label}}\n*Assigned to:* {{action.assignee}}\n\n*Issue:*\n{{action.summary}}\n\n*Action Type:* {{action.type}}',
                },
              },
            ],
            if_false: [
              {
                id: 'notify_rep',
                name: 'Notify rep only',
                type: 'slack_notify',
                config: {
                  channel: '{{action.assignee_slack_dm}}',
                  message_template:
                    '⚠️ Deal needs attention: {{action.target_deal_name}} ({{action.impact_label}})\n\n{{action.summary}}',
                },
              },
            ],
          },
        },
      ],
    } as WorkflowTree,
  },
  {
    name: 'CRM Auto-Update Close Date',
    description: 'Automatically update close dates in HubSpot when actions suggest changes',
    category: 'CRM Automation',
    required_connectors: ['hubspot', 'slack'],
    required_action_types: ['update_close_date'],
    icon: '📅',
    tags: ['crm', 'hubspot', 'automation'],
    tree: {
      version: '1.0',
      trigger: {
        type: 'action_event',
        config: {
          action_types: ['update_close_date'],
        },
      },
      steps: [
        {
          id: 'update_hubspot',
          name: 'Update close date in HubSpot',
          type: 'crm_update',
          config: {
            connector: 'hubspot',
            operation: 'update_deal',
            field_mappings: {
              closedate: '{{action.execution_payload.new_close_date}}',
            },
          },
        },
        {
          id: 'add_note',
          name: 'Add audit note',
          type: 'crm_update',
          config: {
            connector: 'hubspot',
            operation: 'create_note',
            field_mappings: {
              note: 'Close date updated by Pandora workflow. Previous: {{action.execution_payload.old_close_date}}, New: {{action.execution_payload.new_close_date}}. Reason: {{action.summary}}',
              hs_timestamp: '{{action.execution_payload.timestamp}}',
            },
          },
        },
        {
          id: 'confirm_to_rep',
          name: 'Confirm update to rep',
          type: 'slack_notify',
          config: {
            channel: '{{action.assignee_slack_dm}}',
            message_template:
              '✅ Updated close date for *{{action.target_deal_name}}*\n\nOld: {{action.execution_payload.old_close_date}}\nNew: {{action.execution_payload.new_close_date}}\n\nReason: {{action.summary}}',
          },
        },
      ],
    } as WorkflowTree,
  },
  {
    name: 'Data Quality Fix Notification',
    description: 'Notify RevOps team when data quality issues are detected',
    category: 'Data Quality',
    required_connectors: ['slack'],
    required_action_types: ['clean_data'],
    icon: '🧹',
    tags: ['data-quality', 'revops', 'notifications'],
    tree: {
      version: '1.0',
      trigger: {
        type: 'action_event',
        config: {
          action_types: ['clean_data'],
        },
      },
      steps: [
        {
          id: 'notify_revops',
          name: 'Post to #revops',
          type: 'slack_notify',
          config: {
            channel: '#revops',
            message_template:
              '🧹 *Data quality issue detected*\n\n*Entity:* {{action.target_entity_type}} - {{action.target_deal_name}}\n*Source:* {{action.target_source}}\n*Severity:* {{action.severity}}\n\n*Issue:*\n{{action.summary}}\n\n*Recommended fix:*\n{{action.recommended_steps}}',
          },
        },
      ],
    } as WorkflowTree,
  },
  {
    name: 'Weekly Forecast to Slack',
    description: 'Post weekly revenue forecast summary to leadership channel every Monday at 9am ET',
    category: 'Reporting',
    required_connectors: ['slack'],
    required_action_types: [],
    icon: '📊',
    tags: ['reporting', 'forecast', 'weekly'],
    tree: {
      version: '1.0',
      trigger: {
        type: 'schedule',
        config: {
          cron: '0 9 * * 1',
          timezone: 'America/New_York',
        },
      },
      steps: [
        {
          id: 'fetch_forecast',
          name: 'Fetch latest forecast',
          type: 'pandora_callback',
          config: {
            endpoint: '/api/workspaces/{{workspace_id}}/forecast/latest',
            payload: {},
          },
        },
        {
          id: 'post_to_leadership',
          name: 'Post to #revenue-leadership',
          type: 'slack_notify',
          config: {
            channel: '#revenue-leadership',
            message_template:
              '📊 *Weekly Forecast Update*\n\n*This Week:*\n• Projected Close: ${{step_1_fetch_forecast.output.this_week_forecast}}\n• Confidence: {{step_1_fetch_forecast.output.confidence}}%\n\n*This Month:*\n• Projected Close: ${{step_1_fetch_forecast.output.this_month_forecast}}\n• Pipeline Coverage: {{step_1_fetch_forecast.output.coverage}}x\n\n*Top Risks:*\n{{step_1_fetch_forecast.output.top_risks}}',
          },
        },
      ],
    } as WorkflowTree,
  },
];

/**
 * Seed templates into database (idempotent)
 */
export async function seedTemplates(db: Pool): Promise<void> {
  logger.info('Seeding workflow templates', {
    count: SEED_TEMPLATES.length,
  });

  // Check if workflow_templates table exists before attempting to seed
  try {
    const tableCheck = await db.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'workflow_templates'
      ) as exists`
    );
    if (!tableCheck.rows[0]?.exists) {
      logger.warn('workflow_templates table does not exist, skipping seed (run migrations first)');
      return;
    }
  } catch {
    logger.warn('Could not check for workflow_templates table, skipping seed');
    return;
  }

  for (const template of SEED_TEMPLATES) {
    try {
      // Check if template already exists by name
      const existing = await db.query(
        `SELECT id FROM workflow_templates WHERE name = $1`,
        [template.name]
      );

      if (existing.rows.length > 0) {
        // Update existing template
        await db.query(
          `
          UPDATE workflow_templates
          SET description = $1,
              category = $2,
              tree = $3,
              required_connectors = $4,
              required_action_types = $5,
              icon = $6,
              tags = $7
          WHERE name = $8
          `,
          [
            template.description,
            template.category,
            JSON.stringify(template.tree),
            template.required_connectors,
            template.required_action_types,
            template.icon,
            template.tags,
            template.name,
          ]
        );
        logger.debug('[TemplateSeed] Updated template', { name: template.name });
      } else {
        // Insert new template
        await db.query(
          `
          INSERT INTO workflow_templates (
            name, description, category, tree,
            required_connectors, required_action_types,
            icon, tags, popularity
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)
          `,
          [
            template.name,
            template.description,
            template.category,
            JSON.stringify(template.tree),
            template.required_connectors,
            template.required_action_types,
            template.icon,
            template.tags,
          ]
        );
        logger.debug('[TemplateSeed] Created template', { name: template.name });
      }
    } catch (error) {
      logger.error(
        `Failed to seed template: ${template.name}`,
        error instanceof Error ? error : undefined,
        { name: template.name, detail: error instanceof Error ? undefined : String(error) }
      );
    }
  }

  logger.info('Template seeding complete');
}
