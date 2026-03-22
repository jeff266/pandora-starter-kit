import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { query } from '../db.js';
import { tools, callTool } from './tools/index.js';

export function createMcpServer(workspaceId: string): Server {
  const server = new Server(
    { name: 'pandora', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const start = Date.now();

    try {
      const result = await callTool(name, args ?? {}, workspaceId);
      const duration = Date.now() - start;

      await query(
        `INSERT INTO mcp_calls
           (workspace_id, tool_name, input_summary, output_summary, duration_ms)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          workspaceId,
          name,
          JSON.stringify(args ?? {}).slice(0, 500),
          JSON.stringify(result).slice(0, 500),
          duration,
        ]
      ).catch(() => {});

      return {
        content: [{
          type: 'text' as const,
          text: typeof result === 'string'
            ? result
            : JSON.stringify(result, null, 2),
        }],
      };
    } catch (err) {
      const duration = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);

      await query(
        `INSERT INTO mcp_calls
           (workspace_id, tool_name, input_summary, error, duration_ms)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          workspaceId,
          name,
          JSON.stringify(args ?? {}).slice(0, 500),
          message,
          duration,
        ]
      ).catch(() => {});

      throw new McpError(ErrorCode.InternalError, message);
    }
  });

  return server;
}

export async function startStdioServer(workspaceId: string): Promise<void> {
  const server = createMcpServer(workspaceId);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
