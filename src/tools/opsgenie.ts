import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import opsgenie from '@webfx-rd/cloud-utils/opsgenie';

export function register(server: McpServer) {
  server.registerTool(
    'opsgenie-get-alert',
    {
      description: 'Get OpsGenie alert',
      inputSchema: {
        id: z.string().describe('Alert identifier'),
        idType: z
          .enum(['id', 'tiny', 'alias'])
          .default('id')
          .describe('Type of the identifier'),
      },
    },
    async ({ id, idType }) => {
      const alert = await opsgenie.getAlert(id, idType);
      return {
        content: [{ type: 'text', text: JSON.stringify(alert, null, 2) }],
      };
    }
  );
}
