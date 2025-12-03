import { inspect } from 'node:util';
import { z } from 'zod';
import { mysql } from '@webfx-rd/cloud-utils/mysql';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function register(server: McpServer) {
  server.registerTool(
    'site-details',
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
      let where: { site_id: number } | { nanoid: string };
      if (typeof id === 'number') {
        where = { site_id: id };
      } else if (/d+/.test(id)) {
        where = { site_id: Number(id) };
      } else {
        where = { nanoid: id };
      }
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
