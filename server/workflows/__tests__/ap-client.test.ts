/**
 * ActivePieces Client Tests
 *
 * Tests HTTP client with retry logic, caching, and error handling.
 */

import { ActivePiecesClient } from '../ap-client.js';
import { APClientError } from '../types.js';

// Mock fetch globally
global.fetch = jest.fn();

describe('ActivePiecesClient', () => {
  let client: ActivePiecesClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new ActivePiecesClient({
      baseUrl: 'http://test:3000',
      apiKey: 'test-key',
      timeout: 5000,
    });
  });

  const mockResponse = (status: number, body: any) => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  };

  describe('request retry', () => {
    it('should retry on 502 response and succeed', async () => {
      // First call fails with 502, second succeeds
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          text: async () => 'Bad Gateway',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          json: async () => ({ data: [] }),
        });

      const result = await client.listProjects();
      expect(result).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should NOT retry on 400 client error', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      await expect(client.listProjects()).rejects.toThrow(APClientError);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw after max retries exhausted', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      });

      await expect(client.listProjects()).rejects.toThrow(APClientError);
      expect(fetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });
  });

  describe('request timeout', () => {
    it('should throw timeout error', async () => {
      (fetch as jest.Mock).mockImplementationOnce(() =>
        new Promise((resolve) => setTimeout(resolve, 10000))
      );

      await expect(client.listProjects()).rejects.toThrow(/timeout/i);
    });
  });

  describe('createProject', () => {
    it('should send correct request', async () => {
      const project = {
        id: 'proj_123',
        displayName: 'Test Project',
        externalId: 'ws_123',
        metadata: {},
      };

      mockResponse(200, project);

      const result = await client.createProject({
        displayName: 'Test Project',
        externalId: 'ws_123',
      });

      expect(result).toEqual(project);
      expect(fetch).toHaveBeenCalledWith(
        'http://test:3000/api/v1/projects',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            displayName: 'Test Project',
            externalId: 'ws_123',
            metadata: {},
          }),
        })
      );
    });
  });

  describe('getProjectByExternalId', () => {
    it('should return null when no projects match', async () => {
      mockResponse(200, { data: [] });

      const result = await client.getProjectByExternalId('ws_123');
      expect(result).toBeNull();
    });

    it('should return first matching project', async () => {
      const project = { id: 'proj_123', externalId: 'ws_123' };
      mockResponse(200, { data: [project] });

      const result = await client.getProjectByExternalId('ws_123');
      expect(result).toEqual(project);
    });
  });

  describe('triggerFlow', () => {
    it('should use cached version ID on second call', async () => {
      const flow = {
        id: 'flow_123',
        version: { id: 'v1' },
      };

      // First, get the flow to populate cache
      mockResponse(200, flow);
      await client.getFlow('flow_123');

      // Now trigger should not fetch flow again
      const run = { id: 'run_123' };
      mockResponse(200, run);

      const result = await client.triggerFlow('flow_123', { test: 'payload' });

      expect(result).toEqual(run);
      expect(fetch).toHaveBeenCalledTimes(2); // getFlow + triggerFlow, no extra getFlow
    });

    it('should fetch version ID on cache miss', async () => {
      const flow = { id: 'flow_123', version: { id: 'v1' } };
      const run = { id: 'run_123' };

      mockResponse(200, flow); // getFlow
      mockResponse(200, run);  // triggerFlow

      const result = await client.triggerFlow('flow_123', { test: 'payload' });

      expect(result).toEqual(run);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateFlow', () => {
    it('should invalidate version cache', async () => {
      // Populate cache
      const flow1 = { id: 'flow_123', version: { id: 'v1' } };
      mockResponse(200, flow1);
      await client.getFlow('flow_123');

      // Update flow (changes version)
      const flow2 = { id: 'flow_123', version: { id: 'v2' } };
      mockResponse(200, flow2);
      await client.updateFlow('flow_123', { status: 'ENABLED' });

      // Trigger should use new version from cache
      const run = { id: 'run_123' };
      mockResponse(200, run);
      await client.triggerFlow('flow_123', {});

      expect(fetch).toHaveBeenCalledTimes(3);
      // Check that trigger used v2, not v1
      const triggerCall = (fetch as jest.Mock).mock.calls[2][1];
      expect(JSON.parse(triggerCall.body)).toEqual({
        flowVersionId: 'v2',
        payload: {},
      });
    });
  });

  describe('healthCheck', () => {
    it('should return healthy: true on success', async () => {
      mockResponse(200, { data: [] });

      const result = await client.healthCheck();
      expect(result).toEqual({ healthy: true });
    });

    it('should return healthy: false with error message on failure', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const result = await client.healthCheck();
      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
