import { inspect } from 'node:util';
import { z } from 'zod';
import { mysql } from '@webfx-rd/cloud-utils/mysql';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { classifySiteId } from './_shared.js';

export const SITE_DETAILS_TOOL_NAME = 'site-details';

export function register(server: McpServer) {
  server.registerTool(
    SITE_DETAILS_TOOL_NAME,
    {
      description: 'Get details about an RCFX site. Accepts either a numeric and alphanumeric id.',
      inputSchema: {
        id: z.union([z.number(), z.string()]),
      },
      outputSchema: {
        numericId: z.number().describe('AKA MySQL site id'),
        alphanumericId: z.string().describe('AKA Spanner site id or nanoid'),
        name: z.string(),
      },
    },
    async ({ id }) => {
      const { type, value } = classifySiteId(id);
      const where: { site_id: number } | { nanoid: string } =
        type === 'numeric' ? { site_id: value } : { nanoid: value };
      const [whereClause, whereValues] = mysql.buildWhere(where);
      const site = await mysql.readOne(
        `SELECT 
          site_id AS numericId, 
          nanoid AS alphanumericId, 
          name 
        FROM sites 
        WHERE ${whereClause}`,
        {
          instance: 'mcfx',
          database: 'core',
          values: whereValues,
          user: 'rcfx-mcp',
          label: 'MCP:tool:site-details',
          camelcaseResults: true,
        }
      );
      if (!site) {
        throw new Error(`Failed to find site where ${inspect(where)}`);
      }
      return {
        structuredContent: site,
        content: [{ type: 'text', text: JSON.stringify(site) }],
      };
    }
  );
}
