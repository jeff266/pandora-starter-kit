/**
 * Workflow Service Tests
 *
 * Tests the main workflow service CRUD and lifecycle operations.
 */

import { WorkflowService, APClientInterface } from '../workflow-service.js';
import { WorkflowTree, WorkflowValidationError } from '../types.js';

describe('WorkflowService', () => {
  // Mock database
  const mockDb: any = {
    query: jest.fn(),
  };

  // Mock AP client
  const mockApClient: APClientInterface = {
    createProject: jest.fn(),
    getProjectByExternalId: jest.fn(),
    createFlow: jest.fn(),
    updateFlow: jest.fn(),
    getFlowRun: jest.fn(),
    triggerFlow: jest.fn(),
  };

  const validTree: WorkflowTree = {
    version: '1.0',
    trigger: {
      type: 'manual',
      config: {},
    },
    steps: [
      {
        id: 'notify',
        name: 'Send notification',
        type: 'slack_notify',
        config: {
          channel: '#test',
          message_template: 'Test message',
        },
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create workflow in draft state with valid tree', async () => {
      // Mock connector query for validation
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // connector configs
        .mockResolvedValueOnce({ rows: [{ piece_name: '@activepieces/piece-slack' }] }) // registry
        .mockResolvedValueOnce({ rows: [{ ap_project_id: 'proj_123' }] }) // workspace
        .mockResolvedValueOnce({ rows: [] }) // slug collision check
        .mockResolvedValueOnce({ rows: [{ id: 'wf_123', status: 'draft', enabled: false }] }); // insert

      const service = new WorkflowService(mockDb);
      const result = await service.create('ws_123', {
        name: 'Test Workflow',
        slug: 'test-workflow',
        tree: validTree,
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('wf_123');
      expect(result.status).toBe('draft');
      expect(result.enabled).toBe(false);
    });

    it('should throw WorkflowValidationError for invalid tree', async () => {
      const invalidTree: WorkflowTree = {
        version: '1.0',
        trigger: {
          type: 'manual',
          config: {},
        },
        steps: [
          {
            id: 'notify',
            name: 'Send notification',
            type: 'slack_notify',
            config: {
              channel: '#test',
              message_template: 'Invalid {{}} expression', // Empty expression
            },
          },
        ],
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [{ connector_type: 'slack', id: 'conn_123' }] })
        .mockResolvedValueOnce({
          rows: [{
            piece_name: '@activepieces/piece-slack',
            pandora_connector_type: 'slack',
            gate_status: 'available',
          }],
        })
        .mockResolvedValueOnce({ rows: [{ ap_project_id: 'proj_123' }] });

      const service = new WorkflowService(mockDb);

      await expect(service.create('ws_123', {
        name: 'Invalid Workflow',
        slug: 'invalid',
        tree: invalidTree,
      })).rejects.toThrow(WorkflowValidationError);
    });
  });

  describe('activate', () => {
    it('should compile tree and update status to active', async () => {
      const workflow = {
        id: 'wf_123',
        workspace_id: 'ws_123',
        tree: validTree,
        ap_flow_id: null,
        compilation_hash: null,
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [workflow] }) // get workflow
        .mockResolvedValueOnce({ rows: [{ connector_type: 'slack', id: 'conn_123' }] }) // connector configs
        .mockResolvedValueOnce({
          rows: [{
            piece_name: '@activepieces/piece-slack',
            pandora_connector_type: 'slack',
            gate_status: 'available',
          }],
        }) // registry
        .mockResolvedValueOnce({ rows: [{ ap_project_id: 'proj_123', name: 'Test Workspace' }] }) // workspace
        .mockResolvedValueOnce({ rows: [] }) // update
        .mockResolvedValueOnce({
          rows: [{
            ...workflow,
            status: 'active',
            enabled: true,
            compilation_hash: 'abc123',
          }],
        }); // get updated

      (mockApClient.getProjectByExternalId as jest.Mock).mockResolvedValue({ id: 'proj_123' });
      (mockApClient.createFlow as jest.Mock).mockResolvedValue({ id: 'flow_123', version: { id: 'v1' } });
      (mockApClient.updateFlow as jest.Mock).mockResolvedValue({});

      const service = new WorkflowService(mockDb, mockApClient);
      const result = await service.activate('wf_123');

      expect(result.workflow.status).toBe('active');
      expect(result.workflow.enabled).toBe(true);
      expect(result.compiledFlow).toBeDefined();
      expect(mockApClient.updateFlow).toHaveBeenCalledWith(
        'flow_123',
        expect.objectContaining({ status: 'ENABLED' })
      );
    });

    it('should throw if tree validation fails on activate', async () => {
      const invalidWorkflow = {
        id: 'wf_123',
        workspace_id: 'ws_123',
        tree: {
          version: '1.0',
          trigger: { type: 'manual', config: {} },
          steps: [
            {
              id: 'update',
              name: 'Update CRM',
              type: 'crm_update',
              config: {
                connector: 'salesforce',
                operation: 'update_deal',
                field_mappings: {},
              },
            },
          ],
        },
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [invalidWorkflow] })
        .mockResolvedValueOnce({ rows: [] }) // no connectors connected
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ap_project_id: 'proj_123' }] });

      const service = new WorkflowService(mockDb, mockApClient);

      await expect(service.activate('wf_123')).rejects.toThrow(WorkflowValidationError);
    });
  });

  describe('pause', () => {
    it('should set status to paused and enabled to false', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ id: 'wf_123', ap_flow_id: 'flow_123' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'wf_123', status: 'paused', enabled: false }] });

      (mockApClient.updateFlow as jest.Mock).mockResolvedValue({});

      const service = new WorkflowService(mockDb, mockApClient);
      const result = await service.pause('wf_123');

      expect(result.status).toBe('paused');
      expect(result.enabled).toBe(false);
      expect(mockApClient.updateFlow).toHaveBeenCalledWith(
        'flow_123',
        { status: 'DISABLED' }
      );
    });
  });

  describe('execute', () => {
    it('should create workflow_run in running state', async () => {
      const workflow = {
        id: 'wf_123',
        workspace_id: 'ws_123',
        status: 'active',
        ap_flow_id: 'flow_123',
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [workflow] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'run_123',
            workspace_id: 'ws_123',
            workflow_id: 'wf_123',
            status: 'running',
          }],
        });

      (mockApClient.triggerFlow as jest.Mock).mockResolvedValue({ id: 'ap_run_123' });

      const service = new WorkflowService(mockDb, mockApClient);
      const result = await service.execute('wf_123', { test: 'payload' });

      expect(result.id).toBe('run_123');
      expect(result.status).toBe('running');
      expect(mockApClient.triggerFlow).toHaveBeenCalledWith('flow_123', { test: 'payload' });
    });
  });

  describe('createFromTemplate', () => {
    it('should use template tree and check required connectors', async () => {
      const template = {
        id: 'tpl_123',
        name: 'Test Template',
        description: 'Test description',
        tree: validTree,
        required_connectors: ['slack'],
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [template] }) // get template
        .mockResolvedValueOnce({ rows: [{ connector_type: 'slack' }] }) // connected connectors
        .mockResolvedValueOnce({ rows: [{ connector_type: 'slack', id: 'conn_123' }] }) // for validation
        .mockResolvedValueOnce({
          rows: [{
            piece_name: '@activepieces/piece-slack',
            pandora_connector_type: 'slack',
            gate_status: 'available',
          }],
        }) // registry
        .mockResolvedValueOnce({ rows: [{ ap_project_id: 'proj_123' }] }) // workspace
        .mockResolvedValueOnce({ rows: [] }) // slug collision
        .mockResolvedValueOnce({ rows: [{ id: 'wf_123' }] }) // insert
        .mockResolvedValueOnce({ rows: [] }); // update template popularity

      const service = new WorkflowService(mockDb);
      const result = await service.createFromTemplate('ws_123', 'tpl_123');

      expect(result).toBeDefined();
      expect(result.id).toBe('wf_123');
    });

    it('should throw if missing required connector', async () => {
      const template = {
        id: 'tpl_123',
        name: 'Test Template',
        tree: validTree,
        required_connectors: ['hubspot', 'slack'],
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [template] })
        .mockResolvedValueOnce({ rows: [{ connector_type: 'slack' }] }); // only slack connected

      const service = new WorkflowService(mockDb);

      await expect(
        service.createFromTemplate('ws_123', 'tpl_123')
      ).rejects.toThrow(/Missing required connectors: hubspot/);
    });
  });
});
