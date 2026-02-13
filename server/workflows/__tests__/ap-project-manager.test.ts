/**
 * AP Project Manager Tests
 *
 * Tests workspace ↔ AP project lifecycle management.
 */

import { ensureAPProject, cleanupAPProject } from '../ap-project-manager.js';
import { APClientInterface } from '../workflow-service.js';

describe('APProjectManager', () => {
  const mockDb: any = {
    query: jest.fn(),
  };

  const mockApClient: APClientInterface = {
    createProject: jest.fn(),
    getProjectByExternalId: jest.fn(),
    createFlow: jest.fn(),
    updateFlow: jest.fn(),
    getFlowRun: jest.fn(),
    triggerFlow: jest.fn(),
    createConnection: jest.fn(),
    updateConnection: jest.fn(),
    listConnections: jest.fn(),
    listFlows: jest.fn(),
    deleteFlow: jest.fn(),
    deleteConnection: jest.fn(),
    healthCheck: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ensureAPProject', () => {
    it('should return existing ap_project_id from workspace', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            ap_project_id: 'proj_existing',
            name: 'Test Workspace',
          },
        ],
      });

      const result = await ensureAPProject('ws_123', mockApClient as any, mockDb);

      expect(result).toBe('proj_existing');
      expect(mockApClient.createProject).not.toHaveBeenCalled();
    });

    it('should create new project when workspace has no ap_project_id', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ ap_project_id: null, name: 'Test Workspace' }],
        })
        .mockResolvedValueOnce({ rows: [] });

      (mockApClient.getProjectByExternalId as jest.Mock).mockResolvedValue(null);
      (mockApClient.createProject as jest.Mock).mockResolvedValue({
        id: 'proj_new',
        displayName: 'Test Workspace',
        externalId: 'ws_123',
      });

      const result = await ensureAPProject('ws_123', mockApClient as any, mockDb);

      expect(result).toBe('proj_new');
      expect(mockApClient.createProject).toHaveBeenCalledWith({
        displayName: 'Test Workspace',
        externalId: 'ws_123',
        metadata: expect.objectContaining({
          pandora_workspace_id: 'ws_123',
        }),
      });
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE workspaces SET ap_project_id'),
        ['proj_new', 'ws_123']
      );
    });

    it('should find existing AP project by externalId even if workspace lost the mapping', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ ap_project_id: null, name: 'Test Workspace' }],
        })
        .mockResolvedValueOnce({ rows: [] });

      (mockApClient.getProjectByExternalId as jest.Mock).mockResolvedValue({
        id: 'proj_found',
        externalId: 'ws_123',
      });

      const result = await ensureAPProject('ws_123', mockApClient as any, mockDb);

      expect(result).toBe('proj_found');
      expect(mockApClient.createProject).not.toHaveBeenCalled();
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE workspaces SET ap_project_id'),
        ['proj_found', 'ws_123']
      );
    });

    it('should store ap_project_id back to workspace after creation', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ ap_project_id: null, name: 'Test' }],
        })
        .mockResolvedValueOnce({ rows: [] });

      (mockApClient.getProjectByExternalId as jest.Mock).mockResolvedValue(null);
      (mockApClient.createProject as jest.Mock).mockResolvedValue({
        id: 'proj_new',
      });

      await ensureAPProject('ws_123', mockApClient as any, mockDb);

      expect(mockDb.query).toHaveBeenCalledWith(
        'UPDATE workspaces SET ap_project_id = $1 WHERE id = $2',
        ['proj_new', 'ws_123']
      );
    });
  });

  describe('cleanupAPProject', () => {
    it('should delete flows, connections, and clear workspace mapping', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ ap_project_id: 'proj_123' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      (mockApClient.listFlows as jest.Mock).mockResolvedValue([
        { id: 'flow_1' },
        { id: 'flow_2' },
      ]);

      (mockApClient.listConnections as jest.Mock).mockResolvedValue([
        { id: 'conn_1' },
        { id: 'conn_2' },
      ]);

      (mockApClient.deleteFlow as jest.Mock).mockResolvedValue(undefined);
      (mockApClient.deleteConnection as jest.Mock).mockResolvedValue(undefined);

      await cleanupAPProject('ws_123', mockApClient as any, mockDb);

      expect(mockApClient.deleteFlow).toHaveBeenCalledTimes(2);
      expect(mockApClient.deleteConnection).toHaveBeenCalledTimes(2);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE workspaces SET ap_project_id = NULL'),
        ['ws_123']
      );
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM workspace_ap_connections'),
        ['ws_123']
      );
    });
  });
});
