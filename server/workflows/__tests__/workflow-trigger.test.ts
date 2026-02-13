/**
 * Workflow Trigger Tests
 *
 * Tests the action event → workflow execution bridge.
 */

import { onActionCreated, ActionEvent } from '../workflow-trigger.js';
import { WorkflowService } from '../workflow-service.js';

describe('WorkflowTrigger', () => {
  const mockDb: any = {
    query: jest.fn(),
  };

  let mockWorkflowService: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockWorkflowService = {
      execute: jest.fn(),
      db: mockDb,
    };
  });

  const createAction = (overrides?: Partial<ActionEvent>): ActionEvent => ({
    id: 'action_123',
    workspace_id: 'ws_123',
    action_type: 're_engage_deal',
    severity: 'critical',
    source_skill: 'pipeline-hygiene',
    title: 'Deal needs attention',
    summary: 'This deal has been idle for 14 days',
    impact_amount: 75000,
    impact_label: '$75K',
    urgency_label: 'High',
    target_entity_type: 'deal',
    target_entity_id: 'deal_456',
    target_external_id: 'hs_deal_789',
    target_source: 'hubspot',
    assignee: 'john@example.com',
    assignee_slack_dm: '@john',
    recommended_steps: ['Call the prospect', 'Update close date'],
    execution_payload: { deal_id: 'deal_456' },
    created_at: new Date(),
    ...overrides,
  });

  describe('onActionCreated', () => {
    it('should trigger matching workflow', async () => {
      const action = createAction();
      const workflow = {
        id: 'wf_123',
        trigger_config: {
          action_types: ['re_engage_deal'],
          severity_filter: ['critical'],
        },
      };

      mockDb.query.mockResolvedValueOnce({ rows: [workflow] });
      mockWorkflowService.execute.mockResolvedValueOnce({
        id: 'run_123',
        workflow_id: 'wf_123',
      });

      const runs = await onActionCreated(action, mockWorkflowService);

      expect(runs).toHaveLength(1);
      expect(mockWorkflowService.execute).toHaveBeenCalledWith(
        'wf_123',
        expect.objectContaining({
          action: expect.objectContaining({
            id: 'action_123',
            type: 're_engage_deal',
            severity: 'critical',
          }),
        })
      );
    });

    it('should skip workflow that doesn\'t match action_type filter', async () => {
      const action = createAction({ action_type: 'close_stale_deal' });
      const workflow = {
        id: 'wf_123',
        trigger_config: {
          action_types: ['re_engage_deal'], // Different type
        },
      };

      mockDb.query.mockResolvedValueOnce({ rows: [workflow] });

      const runs = await onActionCreated(action, mockWorkflowService);

      expect(runs).toHaveLength(0);
      expect(mockWorkflowService.execute).not.toHaveBeenCalled();
    });

    it('should skip workflow that doesn\'t match severity filter', async () => {
      const action = createAction({ severity: 'warning' });
      const workflow = {
        id: 'wf_123',
        trigger_config: {
          action_types: ['re_engage_deal'],
          severity_filter: ['critical'], // Only critical
        },
      };

      mockDb.query.mockResolvedValueOnce({ rows: [workflow] });

      const runs = await onActionCreated(action, mockWorkflowService);

      expect(runs).toHaveLength(0);
      expect(mockWorkflowService.execute).not.toHaveBeenCalled();
    });

    it('should skip workflow that doesn\'t match source_skills filter', async () => {
      const action = createAction({ source_skill: 'forecasting' });
      const workflow = {
        id: 'wf_123',
        trigger_config: {
          action_types: ['re_engage_deal'],
          source_skills: ['pipeline-hygiene'], // Different skill
        },
      };

      mockDb.query.mockResolvedValueOnce({ rows: [workflow] });

      const runs = await onActionCreated(action, mockWorkflowService);

      expect(runs).toHaveLength(0);
      expect(mockWorkflowService.execute).not.toHaveBeenCalled();
    });

    it('should handle one workflow failure without blocking others', async () => {
      const action = createAction();
      const workflow1 = {
        id: 'wf_123',
        trigger_config: { action_types: ['re_engage_deal'] },
      };
      const workflow2 = {
        id: 'wf_456',
        trigger_config: { action_types: ['re_engage_deal'] },
      };

      mockDb.query.mockResolvedValueOnce({ rows: [workflow1, workflow2] });

      mockWorkflowService.execute
        .mockRejectedValueOnce(new Error('Workflow 1 failed'))
        .mockResolvedValueOnce({ id: 'run_456', workflow_id: 'wf_456' });

      const runs = await onActionCreated(action, mockWorkflowService);

      // Should still execute workflow 2 despite workflow 1 failing
      expect(mockWorkflowService.execute).toHaveBeenCalledTimes(2);
      expect(runs).toHaveLength(1); // Only successful run returned
      expect(runs[0].workflow_id).toBe('wf_456');
    });

    it('should return empty array when no matching workflows', async () => {
      const action = createAction();

      mockDb.query.mockResolvedValueOnce({ rows: [] });

      const runs = await onActionCreated(action, mockWorkflowService);

      expect(runs).toHaveLength(0);
      expect(mockWorkflowService.execute).not.toHaveBeenCalled();
    });

    it('should match workflow with no filters (matches all)', async () => {
      const action = createAction();
      const workflow = {
        id: 'wf_123',
        trigger_config: {
          action_types: ['re_engage_deal'],
          // No severity_filter or source_skills - should match
        },
      };

      mockDb.query.mockResolvedValueOnce({ rows: [workflow] });
      mockWorkflowService.execute.mockResolvedValueOnce({ id: 'run_123' });

      const runs = await onActionCreated(action, mockWorkflowService);

      expect(runs).toHaveLength(1);
      expect(mockWorkflowService.execute).toHaveBeenCalled();
    });
  });
});
