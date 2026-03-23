import type { McpTool } from './index.js';
import { getDimensions } from '../../lib/data-dictionary.js';

export const listDimensions: McpTool = {
  name: 'list_dimensions',
  description: [
    'Lists all confirmed business dimensions for this workspace.',
    'Use the dimension_key values as parameters for other tools to scope queries to a specific segment, region, or product line.',
    'Returns dimension keys, labels, default status, and value field information.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (args: any, workspaceId: string) => {
    const dims = await getDimensions(workspaceId, { confirmedOnly: true });

    if (!dims.length) {
      return {
        calibrated: false,
        message: 'No confirmed dimensions. Run the calibration interview first.',
        dimensions: [],
      };
    }

    return {
      calibrated: true,
      workspace_id: workspaceId,
      dimensions: dims.map(d => ({
        key: d.dimension_key,
        label: d.label,
        is_default: d.is_default,
        confirmed_value: d.confirmed_value,
        confirmed_deal_count: d.confirmed_deal_count,
        value_field: d.value_field_label,
        quota: d.quota_value,
      })),
      total_dimensions: dims.length,
    };
  },
};
