import { inspect } from 'node:util';
import { z } from 'zod';
import { mysql } from '@webfx-rd/cloud-utils/mysql';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function register(server: McpServer) {
  server.registerTool(
    'site-details',
    {
      description: 'Get details about an RCFX site',
      inputSchema: {
        siteId: z.union([
          z.number().describe('A siteId such as 2724'),
          z.string().describe('A nanoid such as lEVsCz4W'),
        ]),
      },
      outputSchema: {
        siteId: z.number(),
        nanoid: z.string(),
        name: z.string(),
      },
    },
    async ({ siteId }) => {
      const where = typeof siteId === 'number' ? { site_id: siteId } : { nanoid: siteId };
      // @ts-expect-error
      const [whereClause, whereValues] = mysql.buildWhere(where);
      const site = await mysql.readOne<{ siteId: number; nanoid: string; name: string }>(
        `SELECT site_id, nanoid, name FROM sites WHERE ${whereClause}`,
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
