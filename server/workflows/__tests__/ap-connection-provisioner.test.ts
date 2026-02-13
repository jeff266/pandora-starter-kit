/**
 * AP Connection Provisioner Tests
 *
 * Tests automatic provisioning of AP connections from Pandora credentials.
 */

import {
  provisionConnections,
  refreshConnection,
  onConnectorDisconnected,
  CONNECTOR_TO_PIECE_MAP,
} from '../ap-connection-provisioner.js';
import { APClientInterface } from '../workflow-service.js';

describe('APConnectionProvisioner', () => {
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
    deleteConnection: jest.fn(),
    healthCheck: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('provisionConnections', () => {
    it('should create connections for all mapped connectors', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            connector_type: 'hubspot',
            credentials: {
              accessToken: 'hub_token',
              refreshToken: 'hub_refresh',
            },
          },
          {
            connector_type: 'slack',
            credentials: {
              botToken: 'slack_token',
            },
          },
        ],
      });

      (mockApClient.listConnections as jest.Mock).mockResolvedValue([]);

      (mockApClient.createConnection as jest.Mock)
        .mockResolvedValueOnce({ id: 'conn_hub' })
        .mockResolvedValueOnce({ id: 'conn_slack' });

      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await provisionConnections(
        'ws_123',
        'proj_123',
        mockApClient as any,
        mockDb
      );

      expect(result.created).toEqual(['hubspot', 'slack']);
      expect(result.updated).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(mockApClient.createConnection).toHaveBeenCalledTimes(2);
    });

    it('should skip connectors with no piece mapping', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            connector_type: 'unknown_connector',
            credentials: {},
          },
        ],
      });

      const result = await provisionConnections(
        'ws_123',
        'proj_123',
        mockApClient as any,
        mockDb
      );

      expect(result.skipped).toEqual(['unknown_connector']);
      expect(result.created).toEqual([]);
    });

    it('should update existing connection instead of creating duplicate', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            connector_type: 'hubspot',
            credentials: {
              accessToken: 'new_token',
              refreshToken: 'new_refresh',
            },
          },
        ],
      });

      (mockApClient.listConnections as jest.Mock).mockResolvedValue([
        {
          id: 'conn_existing',
          externalId: 'pandora_hubspot_ws_123',
        },
      ]);

      (mockApClient.updateConnection as jest.Mock).mockResolvedValue({});
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await provisionConnections(
        'ws_123',
        'proj_123',
        mockApClient as any,
        mockDb
      );

      expect(result.updated).toEqual(['hubspot']);
      expect(result.created).toEqual([]);
      expect(mockApClient.updateConnection).toHaveBeenCalledWith(
        'conn_existing',
        expect.objectContaining({
          value: expect.objectContaining({
            access_token: 'new_token',
          }),
        })
      );
    });
  });

  describe('refreshConnection', () => {
    it('should update AP connection with new credentials', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            ap_connection_id: 'conn_123',
            ap_project_id: 'proj_123',
          },
        ],
      });

      mockDb.query.mockResolvedValueOnce({ rows: [] });

      (mockApClient.updateConnection as jest.Mock).mockResolvedValue({});

      await refreshConnection(
        'ws_123',
        'hubspot',
        { accessToken: 'new_token', refreshToken: 'new_refresh' },
        mockApClient as any,
        mockDb
      );

      expect(mockApClient.updateConnection).toHaveBeenCalledWith(
        'conn_123',
        expect.objectContaining({
          value: expect.objectContaining({
            access_token: 'new_token',
          }),
        })
      );
    });

    it('should create connection if it didn\'t exist', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // No tracking record
        .mockResolvedValueOnce({ rows: [{ ap_project_id: null }] }) // workspace query
        .mockResolvedValueOnce({ rows: [] }); // update connector_configs

      (mockApClient.getProjectByExternalId as jest.Mock).mockResolvedValue({
        id: 'proj_123',
      });

      (mockApClient.listConnections as jest.Mock).mockResolvedValue([]);
      (mockApClient.createConnection as jest.Mock).mockResolvedValue({ id: 'conn_new' });

      mockDb.query.mockResolvedValue({ rows: [] });

      await refreshConnection(
        'ws_123',
        'hubspot',
        { accessToken: 'new_token' },
        mockApClient as any,
        mockDb
      );

      expect(mockApClient.createConnection).toHaveBeenCalled();
    });
  });

  describe('onConnectorDisconnected', () => {
    it('should delete AP connection', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ ap_connection_id: 'conn_123' }] })
        .mockResolvedValueOnce({ rows: [] });

      (mockApClient.deleteConnection as jest.Mock).mockResolvedValue(undefined);

      await onConnectorDisconnected('ws_123', 'hubspot', mockApClient as any, mockDb);

      expect(mockApClient.deleteConnection).toHaveBeenCalledWith('conn_123');
    });

    it('should not throw if connection already gone', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        onConnectorDisconnected('ws_123', 'hubspot', mockApClient as any, mockDb)
      ).resolves.not.toThrow();

      expect(mockApClient.deleteConnection).not.toHaveBeenCalled();
    });
  });

  describe('CONNECTOR_TO_PIECE_MAP', () => {
    it('should extract props correctly for HubSpot', () => {
      const mapping = CONNECTOR_TO_PIECE_MAP.hubspot;
      const creds = {
        accessToken: 'hub_access',
        refreshToken: 'hub_refresh',
        expiresIn: 3600,
      };

      const result = mapping.extractProps(creds);

      expect(result).toEqual({
        access_token: 'hub_access',
        refresh_token: 'hub_refresh',
        expires_in: 3600,
        token_type: 'Bearer',
      });
    });

    it('should extract props correctly for Salesforce', () => {
      const mapping = CONNECTOR_TO_PIECE_MAP.salesforce;
      const creds = {
        accessToken: 'sf_access',
        refreshToken: 'sf_refresh',
        instanceUrl: 'https://example.salesforce.com',
      };

      const result = mapping.extractProps(creds);

      expect(result).toEqual({
        access_token: 'sf_access',
        refresh_token: 'sf_refresh',
        instance_url: 'https://example.salesforce.com',
      });
    });

    it('should extract props correctly for Slack', () => {
      const mapping = CONNECTOR_TO_PIECE_MAP.slack;
      const creds = {
        botToken: 'xoxb-slack-token',
      };

      const result = mapping.extractProps(creds);

      expect(result).toEqual({
        access_token: 'xoxb-slack-token',
      });
    });
  });
});
