/**
 * Workflow Compiler Tests
 *
 * Tests compilation of Pandora trees to ActivePieces flows
 */

import { compileWorkflow, hashTree } from '../compiler.js';
import {
  WorkflowTree,
  WorkflowCompilerContext,
  ConnectorRegistryEntry,
} from '../types.js';

describe('WorkflowCompiler', () => {
  // Mock context
  const mockContext: WorkflowCompilerContext = {
    workspaceId: 'ws_test123',
    apProjectId: 'proj_ap456',
    availableConnections: new Map([
      ['slack', 'conn_slack_123'],
      ['hubspot', 'conn_hubspot_456'],
    ]),
    connectorRegistry: [
      {
        id: '1',
        piece_name: '@activepieces/piece-slack',
        display_name: 'Slack',
        pandora_connector_type: 'slack',
        gate_status: 'available',
        gate_reason: null,
        requires_plan: null,
        piece_version: 'latest',
        supported_triggers: [],
        supported_actions: ['send_message'],
        supports_oauth: true,
        supports_api_key: false,
        auth_type: 'PLATFORM_OAUTH2',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: '2',
        piece_name: '@activepieces/piece-hubspot',
        display_name: 'HubSpot',
        pandora_connector_type: 'hubspot',
        gate_status: 'available',
        gate_reason: null,
        requires_plan: null,
        piece_version: 'latest',
        supported_triggers: [],
        supported_actions: ['update_deal'],
        supports_oauth: true,
        supports_api_key: false,
        auth_type: 'PLATFORM_OAUTH2',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: '3',
        piece_name: '@activepieces/piece-http',
        display_name: 'HTTP Request',
        pandora_connector_type: null,
        gate_status: 'available',
        gate_reason: null,
        requires_plan: null,
        piece_version: 'latest',
        supported_triggers: [],
        supported_actions: ['send_request'],
        supports_oauth: false,
        supports_api_key: false,
        auth_type: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ] as ConnectorRegistryEntry[],
  };

  describe('Simple Workflows', () => {
    it('should compile a simple Slack notification workflow', () => {
      const tree: WorkflowTree = {
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
              channel: '#pipeline-critical',
              message_template: 'Deal needs attention: {{trigger.action.title}}',
            },
          },
        ],
      };

      const result = compileWorkflow(tree, mockContext);

      expect(result.validation.valid).toBe(true);
      expect(result.flow).toBeDefined();
      expect(result.flow?.trigger.type).toBe('EMPTY'); // action_event uses EMPTY trigger
      expect(result.flow?.trigger.nextAction).toBeDefined();
      expect(result.flow?.trigger.nextAction?.type).toBe('PIECE');
      expect(result.flow?.trigger.nextAction?.settings.pieceName).toBe('@activepieces/piece-slack');
    });

    it('should compile a CRM update workflow', () => {
      const tree: WorkflowTree = {
        version: '1.0',
        trigger: {
          type: 'manual',
          config: {},
        },
        steps: [
          {
            id: 'update_deal',
            name: 'Update close date',
            type: 'crm_update',
            config: {
              connector: 'hubspot',
              operation: 'update_deal',
              field_mappings: {
                close_date: '{{trigger.action.execution_payload.new_close_date}}',
              },
            },
          },
        ],
      };

      const result = compileWorkflow(tree, mockContext);

      expect(result.validation.valid).toBe(true);
      expect(result.flow).toBeDefined();
      expect(result.flow?.trigger.nextAction?.settings.pieceName).toBe('@activepieces/piece-hubspot');
    });
  });

  describe('Conditional Workflows', () => {
    it('should compile a conditional workflow', () => {
      const tree: WorkflowTree = {
        version: '1.0',
        trigger: {
          type: 'action_event',
          config: {
            action_types: ['re_engage_deal'],
          },
        },
        steps: [
          {
            id: 'check_amount',
            name: 'Check deal value',
            type: 'conditional',
            config: {
              condition: {
                field: '{{trigger.action.impact_amount}}',
                operator: 'gt',
                value: 100000,
              },
              if_true: [
                {
                  id: 'notify_manager',
                  name: 'Escalate to manager',
                  type: 'slack_notify',
                  config: {
                    channel: '#pipeline-critical',
                    message_template: 'High value deal at risk',
                  },
                },
              ],
              if_false: [
                {
                  id: 'notify_rep',
                  name: 'Notify rep',
                  type: 'slack_notify',
                  config: {
                    channel: '{{trigger.action.assignee_slack_dm}}',
                    message_template: 'Deal needs attention',
                  },
                },
              ],
            },
          },
        ],
      };

      const result = compileWorkflow(tree, mockContext);

      expect(result.validation.valid).toBe(true);
      expect(result.flow?.trigger.nextAction?.type).toBe('BRANCH');
      expect(result.flow?.trigger.nextAction?.onSuccessAction).toBeDefined();
      expect(result.flow?.trigger.nextAction?.onFailureAction).toBeDefined();
    });
  });

  describe('Validation', () => {
    it('should reject workflow with missing required connector', () => {
      const tree: WorkflowTree = {
        version: '1.0',
        trigger: {
          type: 'manual',
          config: {},
        },
        steps: [
          {
            id: 'update_sf',
            name: 'Update Salesforce',
            type: 'crm_update',
            config: {
              connector: 'salesforce',
              operation: 'update_deal',
              field_mappings: {},
            },
          },
        ],
      };

      const result = compileWorkflow(tree, mockContext);

      expect(result.validation.valid).toBe(false);
      expect(result.validation.errors.length).toBeGreaterThan(0);
      expect(result.flow).toBeNull();
    });

    it('should reject workflow with invalid cron expression', () => {
      const tree: WorkflowTree = {
        version: '1.0',
        trigger: {
          type: 'schedule',
          config: {
            cron: 'invalid cron',
            timezone: 'UTC',
          },
        },
        steps: [],
      };

      const result = compileWorkflow(tree, mockContext);

      expect(result.validation.valid).toBe(false);
      expect(result.validation.errors.some((e) => e.includes('cron'))).toBe(true);
    });

    it('should validate expression syntax', () => {
      const tree: WorkflowTree = {
        version: '1.0',
        trigger: {
          type: 'manual',
          config: {},
        },
        steps: [
          {
            id: 'notify',
            name: 'Notify',
            type: 'slack_notify',
            config: {
              channel: '#test',
              message_template: 'Invalid {{}} expression',
            },
          },
        ],
      };

      const result = compileWorkflow(tree, mockContext);

      expect(result.validation.valid).toBe(false);
      expect(result.validation.errors.some((e) => e.includes('empty variable'))).toBe(true);
    });
  });

  describe('hashTree', () => {
    it('should generate consistent hash for same tree', () => {
      const tree: WorkflowTree = {
        version: '1.0',
        trigger: { type: 'manual', config: {} },
        steps: [],
      };

      const hash1 = hashTree(tree);
      const hash2 = hashTree(tree);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(16);
    });

    it('should generate different hash for different trees', () => {
      const tree1: WorkflowTree = {
        version: '1.0',
        trigger: { type: 'manual', config: {} },
        steps: [],
      };

      const tree2: WorkflowTree = {
        version: '1.0',
        trigger: { type: 'action_event', config: { action_types: ['test'] } },
        steps: [],
      };

      const hash1 = hashTree(tree1);
      const hash2 = hashTree(tree2);

      expect(hash1).not.toBe(hash2);
    });
  });
});
